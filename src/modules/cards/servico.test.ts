import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cartoes } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { codigoValido } from "./codigo";
import { buscarCartaoPorCodigo, listarCartoes, obterEstatisticas } from "./repositorio";
import {
  ativarCartao,
  atualizarDescricao,
  configurarDestino,
  criarCartaoComCodigo,
  criarCartoes,
  desativarCartao,
} from "./servico";

let db: Banco;

beforeAll(async () => {
  db = await criarBancoDeTeste();
});

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeDominio> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeDominio) return erro;
    throw erro;
  }
  throw new Error("Esperava um ErroDeDominio, mas a operação teve sucesso.");
}

describe("criação de cartões", () => {
  it("cria cartão não configurado, com código válido", async () => {
    const [cartao] = await criarCartoes(db, 1);
    expect(codigoValido(cartao.codigo)).toBe(true);
    expect(cartao.status).toBe("NAO_CONFIGURADO");
    expect(cartao.destinoUrl).toBeNull();
    expect(cartao.ativadoEm).toBeNull();
  });

  it("gera códigos únicos mesmo quando o sorteio repete códigos existentes", async () => {
    await criarCartaoComCodigo(db, "AAAAAA");
    const sorteios = ["AAAAAA", "BBBBBB", "BBBBBB", "CCCCCC", "DDDDDD"];
    let i = 0;
    const criados = await criarCartoes(db, 3, {}, () => sorteios[i++]);
    expect(criados.map((c) => c.codigo).sort()).toEqual(["BBBBBB", "CCCCCC", "DDDDDD"]);
  });

  it("impede código público duplicado", async () => {
    await criarCartaoComCodigo(db, "DUP222");
    const erro = await erroDe(criarCartaoComCodigo(db, "DUP222"));
    expect(erro.codigo).toBe("CODIGO_DUPLICADO");
  });

  it("o banco rejeita código duplicado mesmo fora do serviço", async () => {
    await criarCartaoComCodigo(db, "DUP333");
    await expect(db.insert(cartoes).values({ codigo: "DUP333" })).rejects.toThrow();
  });

  it("o banco rejeita código fora do formato", async () => {
    await expect(db.insert(cartoes).values({ codigo: "000001" })).rejects.toThrow();
    await expect(db.insert(cartoes).values({ codigo: "abc" })).rejects.toThrow();
    const erro = await erroDe(criarCartaoComCodigo(db, "000001"));
    expect(erro.codigo).toBe("CODIGO_INVALIDO");
  });

  it("o banco impede alterar o código de um cartão existente", async () => {
    await criarCartaoComCodigo(db, "FXX222");
    await expect(
      db.update(cartoes).set({ codigo: "FXX333" }).where(eq(cartoes.codigo, "FXX222")),
    ).rejects.toThrow();
    expect(await buscarCartaoPorCodigo(db, "FXX222")).not.toBeNull();
    expect(await buscarCartaoPorCodigo(db, "FXX333")).toBeNull();
  });

  it("o banco rejeita cartão ativo sem destino", async () => {
    await expect(db.insert(cartoes).values({ codigo: "SEM222", status: "ATIVO" })).rejects.toThrow();
  });
});

describe("configuração de destino", () => {
  it("configura destino do Instagram e ativa o cartão", async () => {
    await criarCartaoComCodigo(db, "NSTA22");
    const cartao = await configurarDestino(db, {
      codigo: "NSTA22",
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/empresa",
    });
    expect(cartao.status).toBe("ATIVO");
    expect(cartao.tipo).toBe("INSTAGRAM");
    expect(cartao.destinoUrl).toBe("https://instagram.com/empresa");
    expect(cartao.ativadoEm).toBeInstanceOf(Date);
  });

  it("configura destino do Google", async () => {
    await criarCartaoComCodigo(db, "GGGG22");
    const cartao = await configurarDestino(db, {
      codigo: "GGGG22",
      tipo: "GOOGLE",
      destinoUrl: "https://g.page/r/example/review",
    });
    expect(cartao.status).toBe("ATIVO");
    expect(cartao.tipo).toBe("GOOGLE");
    expect(cartao.destinoUrl).toBe("https://g.page/r/example/review");
  });

  it("configura URL genérica, normalizando a entrada", async () => {
    await criarCartaoComCodigo(db, "GENE22");
    const cartao = await configurarDestino(db, {
      codigo: "gene22",
      tipo: "GENERICO",
      destinoUrl: " empresa.com.br ",
    });
    expect(cartao.tipo).toBe("GENERICO");
    expect(cartao.destinoUrl).toBe("https://empresa.com.br/");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<h1>x</h1>"],
    ["file:", "file:///etc/passwd"],
  ])("rejeita destino %s e não altera o cartão", async (_nome, destinoUrl) => {
    const [cartao] = await criarCartoes(db, 1);
    const erro = await erroDe(
      configurarDestino(db, { codigo: cartao.codigo, tipo: "GENERICO", destinoUrl }),
    );
    expect(erro.codigo).toBe("DESTINO_INVALIDO");
    const depois = await buscarCartaoPorCodigo(db, cartao.codigo);
    expect(depois?.status).toBe("NAO_CONFIGURADO");
    expect(depois?.destinoUrl).toBeNull();
  });

  it("rejeita link que não corresponde ao tipo escolhido", async () => {
    const [cartao] = await criarCartoes(db, 1);
    const erro = await erroDe(
      configurarDestino(db, {
        codigo: cartao.codigo,
        tipo: "INSTAGRAM",
        destinoUrl: "https://malicioso.com/instagram.com",
      }),
    );
    expect(erro.codigo).toBe("DESTINO_INVALIDO");
  });

  it("informa quando o cartão não existe ou o código é inválido", async () => {
    const naoExiste = await erroDe(
      configurarDestino(db, { codigo: "ZZZZZ9", tipo: "GENERICO", destinoUrl: "https://a.com.br" }),
    );
    expect(naoExiste.codigo).toBe("CARTAO_NAO_ENCONTRADO");
    const invalido = await erroDe(
      configurarDestino(db, { codigo: "x", tipo: "GENERICO", destinoUrl: "https://a.com.br" }),
    );
    expect(invalido.codigo).toBe("CODIGO_INVALIDO");
  });

  it("alterar o destino não muda id, código, data de criação nem data de ativação", async () => {
    const original = await criarCartaoComCodigo(db, "MUDA22");
    const primeiro = await configurarDestino(db, {
      codigo: "MUDA22",
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/empresaA",
    });
    const segundo = await configurarDestino(db, {
      codigo: "MUDA22",
      tipo: "GOOGLE",
      destinoUrl: "https://g.page/r/example/review",
    });
    expect(segundo.destinoUrl).toBe("https://g.page/r/example/review");
    expect(segundo.tipo).toBe("GOOGLE");
    expect(segundo.id).toBe(original.id);
    expect(segundo.codigo).toBe("MUDA22");
    expect(segundo.criadoEm).toEqual(original.criadoEm);
    expect(segundo.ativadoEm).toEqual(primeiro.ativadoEm);
  });
});

describe("ativação e desativação", () => {
  it("desativa e reativa um cartão configurado, preservando o destino", async () => {
    await criarCartaoComCodigo(db, "ATV222");
    await configurarDestino(db, {
      codigo: "ATV222",
      tipo: "GENERICO",
      destinoUrl: "https://empresa.com.br",
    });
    const inativo = await desativarCartao(db, "ATV222");
    expect(inativo.status).toBe("INATIVO");
    expect(inativo.destinoUrl).toBe("https://empresa.com.br/");
    const ativo = await ativarCartao(db, "ATV222");
    expect(ativo.status).toBe("ATIVO");
    expect(ativo.destinoUrl).toBe("https://empresa.com.br/");
  });

  it("não ativa cartão sem destino", async () => {
    await criarCartaoComCodigo(db, "ATV333");
    const erro = await erroDe(ativarCartao(db, "ATV333"));
    expect(erro.codigo).toBe("TRANSICAO_INVALIDA");
  });

  it("cartão desativado antes de configurar volta a aguardar configuração", async () => {
    await criarCartaoComCodigo(db, "ATV444");
    await desativarCartao(db, "ATV444");
    const reativado = await ativarCartao(db, "ATV444");
    expect(reativado.status).toBe("NAO_CONFIGURADO");
  });

  it("alterar destino de cartão inativo só reativa quando pedido", async () => {
    await criarCartaoComCodigo(db, "ATV555");
    await configurarDestino(db, { codigo: "ATV555", tipo: "GENERICO", destinoUrl: "https://a.com.br" });
    await desativarCartao(db, "ATV555");
    const aindaInativo = await configurarDestino(db, {
      codigo: "ATV555",
      tipo: "GENERICO",
      destinoUrl: "https://b.com.br",
    });
    expect(aindaInativo.status).toBe("INATIVO");
    expect(aindaInativo.destinoUrl).toBe("https://b.com.br/");
    const reativado = await configurarDestino(db, {
      codigo: "ATV555",
      tipo: "GENERICO",
      destinoUrl: "https://c.com.br",
      ativar: true,
    });
    expect(reativado.status).toBe("ATIVO");
  });

  it("atualiza a descrição sem tocar no restante", async () => {
    await criarCartaoComCodigo(db, "DESC22");
    const cartao = await atualizarDescricao(db, "DESC22", "  Padaria do João  ");
    expect(cartao.descricao).toBe("Padaria do João");
    expect(cartao.status).toBe("NAO_CONFIGURADO");
    const erro = await erroDe(atualizarDescricao(db, "DESC22", "x".repeat(201)));
    expect(erro.codigo).toBe("ENTRADA_INVALIDA");
  });
});

describe("consultas do painel", () => {
  it("busca por código, destino e descrição, e filtra por status e tipo", async () => {
    const banco = await criarBancoDeTeste();
    await criarCartaoComCodigo(banco, "BUSCA2", { descricao: "Pizzaria Bella" });
    await criarCartaoComCodigo(banco, "BUSCA3");
    await criarCartaoComCodigo(banco, "BUSCA4");
    await configurarDestino(banco, {
      codigo: "BUSCA3",
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/cafe_central",
    });
    await configurarDestino(banco, {
      codigo: "BUSCA4",
      tipo: "GOOGLE",
      destinoUrl: "https://g.page/r/abc/review",
    });
    await desativarCartao(banco, "BUSCA4");

    const codigos = async (filtro: Parameters<typeof listarCartoes>[1]) =>
      (await listarCartoes(banco, filtro)).itens.map((c) => c.codigo).sort();

    expect(await codigos({ busca: "busca3" })).toEqual(["BUSCA3"]);
    expect(await codigos({ busca: "cafe_central" })).toEqual(["BUSCA3"]);
    expect(await codigos({ busca: "pizzaria" })).toEqual(["BUSCA2"]);
    expect(await codigos({ status: "INATIVO" })).toEqual(["BUSCA4"]);
    expect(await codigos({ tipo: "INSTAGRAM" })).toEqual(["BUSCA3"]);
    expect(await codigos({ busca: "%" })).toEqual([]);
    expect((await listarCartoes(banco, { porPagina: 2 })).total).toBe(3);

    expect(await obterEstatisticas(banco)).toEqual({
      total: 3,
      naoConfigurados: 1,
      ativos: 1,
      inativos: 1,
      instagram: 1,
      google: 1,
    });
  });
});
