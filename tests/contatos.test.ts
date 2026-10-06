// Contatos no painel: lista, filtros, acompanhamento, exclusão a pedido do titular e exportação.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contatos } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { VERSAO_DO_TEXTO_DE_PRIVACIDADE } from "@/modules/activation/privacidade";
import { ativarPeloCliente, definirAtivacaoPeloCliente } from "@/modules/activation/servico";
import { validarAtivacao } from "@/modules/activation/validacao";
import { criarLote } from "@/modules/batches/servico";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import {
  atualizarAcompanhamento,
  buscarContato,
  buscarContatoDoCartao,
  campoDoCsv,
  contarContatosDoLote,
  contarContatosNovos,
  excluirContato,
  gerarCsvDeContatos,
  listarContatos,
  listarLotesComContatos,
  quemDecide,
} from "@/modules/contacts/servico";
import { criarBancoDeTeste } from "./banco-de-teste";

const estado = vi.hoisted(() => ({
  db: undefined as unknown,
  admin: null as { id: string; email: string } | null,
}));
vi.mock("@/db/cliente", () => ({ obterBanco: () => estado.db }));
vi.mock("@/modules/auth/sessao", () => ({ obterAdminAtual: async () => estado.admin }));

import { GET as exportarContatos } from "@/app/admin/contatos/exportar/route";
import { filtroParaConsulta, lerFiltroDeContatos } from "@/app/admin/contatos/filtro";

let db: Banco;
let loteA: string;
let loteB: string;
const codigos: Record<string, string> = {};

interface Pessoa {
  chave: string;
  lote: "A" | "B";
  codigo: string;
  campos: Record<string, string>;
}

const PESSOAS: Pessoa[] = [
  { chave: "padaria1", lote: "A", codigo: "CT2222", campos: { loja: "Padaria do Zé", ramo: "RESTAURANTE", nome: "José da Silva", papel: "DONO", whatsapp: "(11) 91234-5678", ofertas: "sim", link: "@padariadoze" } },
  { chave: "padaria2", lote: "A", codigo: "CT3333", campos: { loja: "Padaria do Zé — Filial", nome: "Ana Lima", papel: "GERENTE", decisor: "José da Silva", whatsapp: "11 91234 5678", link: "@padariadoze2" } },
  { chave: "padaria3", lote: "B", codigo: "CT4444", campos: { loja: "Padaria do Zé (Centro)", nome: "José da Silva", papel: "DONO", whatsapp: "+55 (11) 91234-5678", ofertas: "sim", link: "https://g.page/r/abc/review" } },
  { chave: "salao", lote: "B", codigo: "CT5555", campos: { loja: "Salão Bela", ramo: "BELEZA", nome: "Carla Souza", papel: "FUNCIONARIO", decisor: "Dona Bela", whatsapp: "(35) 3821-1234", link: "https://maps.app.goo.gl/AbCdEf123" } },
];

beforeAll(async () => {
  db = await criarBancoDeTeste();
  estado.db = db;
  vi.spyOn(console, "info").mockImplementation(() => {});

  const filaA = PESSOAS.filter((p) => p.lote === "A").map((p) => p.codigo);
  const filaB = PESSOAS.filter((p) => p.lote === "B").map((p) => p.codigo);
  loteA = (await criarLote(db, { quantidade: 2, tipo: "INSTAGRAM", descricao: null }, { gerarCodigo: () => filaA.shift()! })).lote.identificador;
  loteB = (await criarLote(db, { quantidade: 2, tipo: "GOOGLE", descricao: null }, { gerarCodigo: () => filaB.shift()! })).lote.identificador;
  await definirAtivacaoPeloCliente(db, loteA, true, []);
  await definirAtivacaoPeloCliente(db, loteB, true, []);

  let minuto = 0;
  for (const pessoa of PESSOAS) {
    const validacao = validarAtivacao(pessoa.campos, pessoa.lote === "A" ? "INSTAGRAM" : "GOOGLE");
    if (!validacao.ok) throw new Error(`Dados de teste inválidos: ${JSON.stringify(validacao.erros)}`);
    const ativacao = await ativarPeloCliente(
      db,
      pessoa.codigo,
      validacao.dados,
      VERSAO_DO_TEXTO_DE_PRIVACIDADE,
      new Date(Date.UTC(2026, 9, 6, 15, minuto++)),
    );
    if (ativacao.resultado !== "ATIVADO") throw new Error(`Não ativou: ${pessoa.chave}`);
    codigos[pessoa.chave] = pessoa.codigo;
  }
});

beforeEach(() => {
  estado.admin = { id: "admin-1", email: "admin@exemplo.com.br" };
});

const lojas = (lista: { loja: string }[]) => lista.map((contato) => contato.loja);

describe("lista de contatos", () => {
  it("mostra os mais recentes primeiro, com todas as informações da ativação", async () => {
    const lista = await listarContatos(db);
    expect(lojas(lista)).toEqual(["Salão Bela", "Padaria do Zé (Centro)", "Padaria do Zé — Filial", "Padaria do Zé"]);
    const salao = lista[0];
    expect(salao).toMatchObject({
      nome: "Carla Souza",
      papel: "FUNCIONARIO",
      decisor: "Dona Bela",
      whatsapp: "+553538211234",
      ramo: "BELEZA",
      cartaoCodigo: "CT5555",
      loteIdentificador: loteB,
      tipo: "GOOGLE",
      aceitouOfertas: false,
      situacao: "NOVO",
    });
    expect(quemDecide(salao)).toBe("Dona Bela");
    expect(quemDecide(lista[3])).toBe("José da Silva");
  });

  it("indica quando o mesmo WhatsApp ativou vários cartões", async () => {
    const lista = await listarContatos(db);
    const porLoja = Object.fromEntries(lista.map((contato) => [contato.loja, contato.cartoesDaLoja]));
    expect(porLoja).toEqual({
      "Padaria do Zé": 3,
      "Padaria do Zé — Filial": 3,
      "Padaria do Zé (Centro)": 3,
      "Salão Bela": 1,
    });
    // A contagem considera todos os contatos, mesmo com um filtro que mostra só um deles.
    const [soUm] = await listarContatos(db, { lote: loteB, busca: "Centro" });
    expect(soUm.cartoesDaLoja).toBe(3);
    const detalhe = await buscarContato(db, soUm.id);
    expect(detalhe?.cartoesDaLoja).toBe(3);
  });

  it("filtra por lote, situação e aceite de ofertas, e busca por loja, nome, WhatsApp e cartão", async () => {
    expect(lojas(await listarContatos(db, { lote: loteA }))).toEqual(["Padaria do Zé — Filial", "Padaria do Zé"]);
    expect(lojas(await listarContatos(db, { aceitouOfertas: true }))).toEqual(["Padaria do Zé (Centro)", "Padaria do Zé"]);
    expect(lojas(await listarContatos(db, { aceitouOfertas: false }))).toEqual(["Salão Bela", "Padaria do Zé — Filial"]);
    expect(lojas(await listarContatos(db, { busca: "salão" }))).toEqual(["Salão Bela"]);
    expect(lojas(await listarContatos(db, { busca: "carla" }))).toEqual(["Salão Bela"]);
    expect(lojas(await listarContatos(db, { busca: "Dona Bela" }))).toEqual(["Salão Bela"]);
    expect(lojas(await listarContatos(db, { busca: "(35) 3821-1234" }))).toEqual(["Salão Bela"]);
    expect(lojas(await listarContatos(db, { busca: "CT5555" }))).toEqual(["Salão Bela"]);
    expect(lojas(await listarContatos(db, { busca: "91234" }))).toHaveLength(3);
    expect(await listarContatos(db, { busca: "100%_" })).toEqual([]);
    expect(await listarContatos(db, { situacao: "CLIENTE" })).toEqual([]);
    expect(await listarLotesComContatos(db)).toEqual([loteB, loteA].sort().reverse());
    expect(await contarContatosDoLote(db, loteA)).toBe(2);
  });

  it("lê os filtros da URL sem confiar no que vem nela", () => {
    expect(lerFiltroDeContatos({ q: "  padaria ", lote: loteA, situacao: "CONVERSANDO", ofertas: "sim" })).toEqual({
      busca: "padaria",
      lote: loteA,
      situacao: "CONVERSANDO",
      aceitouOfertas: true,
    });
    expect(lerFiltroDeContatos({ lote: "'; drop table contatos; --", situacao: "HACKEADO", ofertas: "talvez" })).toEqual({
      busca: undefined,
      lote: undefined,
      situacao: undefined,
      aceitouOfertas: undefined,
    });
    expect(filtroParaConsulta({ busca: "zé", aceitouOfertas: false })).toBe("?q=z%C3%A9&ofertas=nao");
    expect(filtroParaConsulta({})).toBe("");
  });
});

describe("acompanhamento", () => {
  it("contador de novos acompanha a situação; observação é opcional", async () => {
    expect(await contarContatosNovos(db)).toBe(4);
    const [salao] = await listarContatos(db, { busca: "Salão" });

    const conversando = await atualizarAcompanhamento(db, salao.id, { situacao: "CONVERSANDO" });
    expect(conversando).toMatchObject({ situacao: "CONVERSANDO", observacao: null });
    expect(await contarContatosNovos(db)).toBe(3);

    const comObservacao = await atualizarAcompanhamento(db, salao.id, {
      situacao: "CLIENTE",
      observacao: "  Comprou mais 5 cartões.  ",
    });
    expect(comObservacao).toMatchObject({ situacao: "CLIENTE", observacao: "Comprou mais 5 cartões." });
    // Trocar só a situação (na lista) não apaga a observação.
    expect(await atualizarAcompanhamento(db, salao.id, { situacao: "SEM_INTERESSE" })).toMatchObject({
      situacao: "SEM_INTERESSE",
      observacao: "Comprou mais 5 cartões.",
    });
    expect(lojas(await listarContatos(db, { situacao: "SEM_INTERESSE" }))).toEqual(["Salão Bela"]);
    await atualizarAcompanhamento(db, salao.id, { situacao: "NOVO", observacao: "" });
    expect((await buscarContato(db, salao.id))?.observacao).toBeNull();
  });

  it("recusa situação desconhecida, observação longa demais e contato inexistente", async () => {
    const [salao] = await listarContatos(db, { busca: "Salão" });
    await expect(atualizarAcompanhamento(db, salao.id, { situacao: "FECHADO" })).rejects.toThrow("Escolha a situação do contato.");
    await expect(atualizarAcompanhamento(db, salao.id, { situacao: "NOVO", observacao: "x".repeat(1001) })).rejects.toThrow(
      "no máximo 1000 caracteres",
    );
    await expect(atualizarAcompanhamento(db, "00000000-0000-4000-8000-000000000000", { situacao: "NOVO" })).rejects.toThrow(
      "Contato não encontrado.",
    );
    await expect(atualizarAcompanhamento(db, "abc", { situacao: "NOVO" })).rejects.toThrow("Contato não encontrado.");
  });
});

describe("exportação em CSV", () => {
  it("protege contra fórmulas: valores que começam com =, +, - ou @ ganham um apóstrofo", () => {
    expect(campoDoCsv("=HYPERLINK(\"http://golpe\",\"clique\")")).toBe(`"'=HYPERLINK(""http://golpe"",""clique"")"`);
    expect(campoDoCsv("+5511912345678")).toBe("'+5511912345678");
    expect(campoDoCsv("-2+3")).toBe("'-2+3");
    expect(campoDoCsv("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(campoDoCsv("\t=1+1")).toBe("'\t=1+1");
    expect(campoDoCsv("Padaria do Zé")).toBe("Padaria do Zé");
    expect(campoDoCsv("Loja, Café & Cia")).toBe('"Loja, Café & Cia"');
    expect(campoDoCsv('Bar "do Canto"')).toBe('"Bar ""do Canto"""');
    expect(campoDoCsv("linha 1\nlinha 2")).toBe('"linha 1\nlinha 2"');
    expect(campoDoCsv(null)).toBe("");
    expect(campoDoCsv(3)).toBe("3");
  });

  it("um nome de loja malicioso, digitado na página pública, sai neutralizado no arquivo", async () => {
    const { lote } = await criarLote(db, { quantidade: 1, tipo: "INSTAGRAM", descricao: null }, { gerarCodigo: () => "CT6666" });
    await definirAtivacaoPeloCliente(db, lote.identificador, true, []);
    const validacao = validarAtivacao(
      { loja: "=cmd|' /C calc'!A0", nome: "@SUM(1+1) Silva", papel: "OUTRO", decisor: "+Maria", whatsapp: "(21) 98888-7777", link: "@loja" },
      "INSTAGRAM",
    );
    if (!validacao.ok) throw new Error("dados de teste inválidos");
    await ativarPeloCliente(db, "CT6666", validacao.dados, VERSAO_DO_TEXTO_DE_PRIVACIDADE);

    const csv = gerarCsvDeContatos(await listarContatos(db, { busca: "CT6666" }));
    const [, linha] = csv.trimEnd().split("\r\n");
    expect(linha.startsWith("'=cmd|' /C calc'!A0,'@SUM(1+1) Silva,Outro,'+Maria,(21) 98888-7777,5521988887777,")).toBe(true);
    // Nenhuma célula do arquivo começa com um caractere de fórmula.
    for (const celula of linha.split(",")) expect(celula).not.toMatch(/^"?[=+\-@]/);
  });

  it("traz as colunas do painel, com BOM para o Excel e datas no horário de Brasília", async () => {
    const csv = gerarCsvDeContatos(await listarContatos(db, { lote: loteA }));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).trimEnd().split("\r\n");
    expect(linhas[0]).toBe(
      "loja,nome,funcao,quem_decide,whatsapp,whatsapp_com_ddi,ramo,cartao,lote,tipo,ativado_em,aceitou_ofertas,situacao,observacao,cartoes_da_loja",
    );
    expect(linhas[2]).toBe(
      `Padaria do Zé,José da Silva,Dono,José da Silva,(11) 91234-5678,5511912345678,Restaurante e lanchonete,CT2222,${loteA},Instagram,06/10/2026 12:00,sim,Novo,,3`,
    );
    expect(linhas[1]).toContain("Padaria do Zé — Filial,Ana Lima,Gerente,José da Silva,");
  });

  it("a rota exige administrador e respeita os filtros", async () => {
    estado.admin = null;
    const semSessao = await exportarContatos(new Request("https://go.example.com/admin/contatos/exportar"));
    expect(semSessao.status).toBe(401);
    expect(await semSessao.text()).toBe("Não autorizado.");

    estado.admin = { id: "admin-1", email: "admin@exemplo.com.br" };
    const resposta = await exportarContatos(
      new Request(`https://go.example.com/admin/contatos/exportar?lote=${loteB}&ofertas=sim`),
    );
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(resposta.headers.get("Content-Disposition")).toMatch(/^attachment; filename="contatos-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(resposta.headers.get("Cache-Control")).toBe("private, no-store");
    const linhas = (await resposta.text()).trimEnd().split("\r\n");
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toContain("Padaria do Zé (Centro)");
  });
});

describe("exclusão a pedido do titular", () => {
  it("apaga os dados do contato e o cartão continua ativo, abrindo o mesmo link", async () => {
    const codigo = codigos.padaria2;
    const cartaoAntes = await buscarCartaoPorCodigo(db, codigo);
    const contato = await buscarContatoDoCartao(db, cartaoAntes!.id);
    expect(contato?.loja).toBe("Padaria do Zé — Filial");

    expect(await excluirContato(db, contato!.id)).toEqual({ cartaoCodigo: codigo });

    expect(await buscarContato(db, contato!.id)).toBeNull();
    expect(await buscarContatoDoCartao(db, cartaoAntes!.id)).toBeNull();
    expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo))).toEqual([]);
    // O cartão não foi tocado.
    expect(await buscarCartaoPorCodigo(db, codigo)).toEqual(cartaoAntes);
    expect(cartaoAntes).toMatchObject({ status: "ATIVO", destinoUrl: "https://www.instagram.com/padariadoze2/" });

    // Os outros contatos da mesma loja continuam, com a contagem atualizada.
    const [outro] = await listarContatos(db, { busca: "CT2222" });
    expect(outro.cartoesDaLoja).toBe(2);
    await expect(excluirContato(db, contato!.id)).rejects.toThrow("Contato não encontrado.");
  });
});
