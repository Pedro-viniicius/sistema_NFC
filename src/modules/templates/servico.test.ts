// Ciclo de vida dos templates de impressão, com banco real (PGlite + migrações) e armazenamento em memória.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { lotes, templatesDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { criarLote, excluirLote } from "@/modules/batches/servico";
import { CODIGO_DE_TESTE, codigoValido } from "@/modules/cards/codigo";
import { criarCartaoComCodigo } from "@/modules/cards/servico";
import { resolverRedirecionamento } from "@/modules/redirects/resolver";
import { ArmazenamentoEmMemoria } from "@/modules/storage/memoria";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { lerFixture } from "../../../tests/fixtures-de-template";
import { lerDesenhosDoQr, lerPaginasDoPdf } from "../../../tests/ler-pdf-de-template";
import { criarPdfDeTemplate } from "../../../tests/pdf-de-template";
import { lerQrDaPagina } from "../../../tests/renderizar-pdf";
import {
  AREA_DO_QR_NAS_FIXTURES,
  criarRascunho,
  criarTemplatePronto,
  enviarArquivo,
} from "../../../tests/templates-de-teste";
import {
  ativarTemplate,
  atualizarDadosDoTemplate,
  buscarTemplate,
  chaveDeTemplateValida,
  configurarQrDoTemplate,
  definirTemplatePadrao,
  duplicarTemplate,
  excluirTemplate,
  gerarChaveDoTemplate,
  gerarPdfDeTeste,
  inativarTemplate,
  listarTemplates,
  listarTemplatesParaNovosLotes,
  nomeDaNovaVersao,
  pendenciasParaAtivar,
  registrarTemplateEnviado,
  substituirArquivoDoTemplate,
  testarQrDoTemplate,
} from "./servico";
import { calcularSha256 } from "./validacao-do-pdf";

let db: Banco;
let armazenamento: ArmazenamentoEmMemoria;

beforeEach(async () => {
  db = await criarBancoDeTeste();
  armazenamento = new ArmazenamentoEmMemoria();
});

const AREA = { area: AREA_DO_QR_NAS_FIXTURES, zonaDeSilencioModulos: 4 };

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeDominio> {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeDominio);
    return erro as ErroDeDominio;
  }
  throw new Error("A operação deveria ter sido recusada.");
}

async function recarregar(id: string) {
  const template = await buscarTemplate(db, id);
  if (!template) throw new Error("Template não encontrado.");
  return template;
}

describe("registro do arquivo enviado", () => {
  it("cria um RASCUNHO com os metadados do PDF logo depois do envio", async () => {
    const bytes = lerFixture("template-google");
    const chave = await enviarArquivo(armazenamento, bytes);
    const template = await registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "cartao_google.pdf" });

    expect(template.status).toBe("RASCUNHO");
    expect(template.padrao).toBe(false);
    expect(template.tipo).toBeNull();
    expect(template.nome).toBe("cartao_google");
    expect(template.arquivoNomeOriginal).toBe("cartao_google.pdf");
    expect(template.chaveDoArquivo).toBe(chave);
    expect(template.mimeType).toBe("application/pdf");
    expect(template.tamanhoBytes).toBe(bytes.length);
    expect(template.sha256).toBe(calcularSha256(bytes));
    expect(template.numeroDePaginas).toBe(1);
    expect(template.rotacao).toBe(0);
    expect(template.mediaBox).toEqual([0, 0, 368.646, 245.764]);
    expect(template.larguraDaPaginaMm).toBeCloseTo(130.05, 2);
    expect(template.qrXPt).toBeNull();
    expect(template.qrTestadoEm).toBeNull();
    expect(template.bloqueadoEm).toBeNull();
    expect(template.qrZonaDeSilencioModulos).toBe(4);
  });

  it("confirmar duas vezes o mesmo envio não cria dois templates", async () => {
    const chave = await enviarArquivo(armazenamento, lerFixture("template-google"));
    const primeiro = await registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "a.pdf" });
    const segundo = await registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "a.pdf" });
    expect(segundo.id).toBe(primeiro.id);
    expect(await listarTemplates(db)).toHaveLength(1);
    expect(armazenamento.chaves()).toEqual([chave]);
  });

  it("arquivo inválido é recusado E apagado do armazenamento (sem órfãos)", async () => {
    for (const fixture of [
      "duas-paginas",
      "pagina-rotacionada",
      "protegido-por-senha",
      "com-javascript",
      "truncado",
      "malformado",
      "nao-e-pdf",
    ] as const) {
      const chave = await enviarArquivo(armazenamento, lerFixture(fixture));
      const erro = await erroDe(registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "arte.pdf" }));
      expect(erro.codigo).toBe("TEMPLATE_INVALIDO");
      expect(armazenamento.chaves()).toEqual([]);
    }
    expect(await listarTemplates(db)).toEqual([]);
  });

  it("recusa referências de arquivo fora da pasta dos templates", async () => {
    for (const chave of ["../segredo.pdf", "outra-pasta/arte.pdf", "templates-impressao/arte.txt", "", "templates-impressao/a/b.pdf"]) {
      expect(chaveDeTemplateValida(chave)).toBe(false);
      const erro = await erroDe(registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "arte.pdf" }));
      expect(erro.message).toBe("Referência de arquivo inválida.");
    }
    expect(chaveDeTemplateValida(gerarChaveDoTemplate())).toBe(true);
    // Formato das chaves do envio direto (nome fixo + sufixo aleatório).
    expect(chaveDeTemplateValida("templates-impressao/template-Xk29dPq0aZ.pdf")).toBe(true);
  });

  it("arquivo que não chegou ao armazenamento", async () => {
    const erro = await erroDe(
      registrarTemplateEnviado(db, armazenamento, { chave: gerarChaveDoTemplate(), nomeOriginal: "arte.pdf" }),
    );
    expect(erro.message).toContain("não foi encontrado no armazenamento");
  });
});

describe("RASCUNHO → PRONTO", () => {
  it("PRONTO exige produto, área do QR e um teste bem-sucedido", async () => {
    const chave = await enviarArquivo(armazenamento, lerFixture("template-google"));
    const { id } = await registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: "arte.pdf" });

    expect(pendenciasParaAtivar(await recarregar(id))).toEqual([
      "Escolha o produto do template.",
      "Configure a área do QR Code.",
    ]);
    expect((await erroDe(ativarTemplate(db, armazenamento, id))).message).toContain("Ainda não é possível ativar");

    await atualizarDadosDoTemplate(db, id, { nome: "Google — Modelo 01", tipo: "GOOGLE" });
    await configurarQrDoTemplate(db, id, AREA);
    expect(pendenciasParaAtivar(await recarregar(id))).toEqual(["Faça o teste do QR Code com a configuração atual."]);
    expect((await erroDe(ativarTemplate(db, armazenamento, id))).message).toContain("Faça o teste do QR Code");
    expect((await recarregar(id)).status).toBe("RASCUNHO");

    const testado = await testarQrDoTemplate(db, armazenamento, id);
    expect(testado.qrTestadoEm).not.toBeNull();
    expect(testado.qrTestadoEm!.getTime()).toBeGreaterThanOrEqual(testado.qrConfiguradoEm!.getTime());
    expect(pendenciasParaAtivar(testado)).toEqual([]);

    const pronto = await ativarTemplate(db, armazenamento, id);
    expect(pronto.status).toBe("PRONTO");
    expect(pronto.padrao).toBe(false);
  });

  it("o banco também recusa um PRONTO sem teste (não é só regra de tela)", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    await configurarQrDoTemplate(db, rascunho.id, AREA);
    await expect(
      db.update(templatesDeImpressao).set({ status: "PRONTO" }).where(eq(templatesDeImpressao.id, rascunho.id)),
    ).rejects.toThrow();
    await expect(
      db.update(templatesDeImpressao).set({ padrao: true }).where(eq(templatesDeImpressao.id, rascunho.id)),
    ).rejects.toThrow();
  });

  it("alterar a área do QR invalida o teste e devolve o template a RASCUNHO", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento, { padrao: true });
    expect(pronto.status).toBe("PRONTO");
    expect(pronto.padrao).toBe(true);

    const alterado = await configurarQrDoTemplate(db, pronto.id, {
      area: { ...AREA_DO_QR_NAS_FIXTURES, x: AREA_DO_QR_NAS_FIXTURES.x - 5 },
      zonaDeSilencioModulos: 4,
    });
    expect(alterado.status).toBe("RASCUNHO");
    expect(alterado.qrTestadoEm).toBeNull();
    expect(alterado.padrao).toBe(false);
    expect((await erroDe(ativarTemplate(db, armazenamento, pronto.id))).message).toContain("Faça o teste");

    // Mudar só a zona de silêncio também é uma mudança de configuração.
    await testarQrDoTemplate(db, armazenamento, pronto.id);
    await ativarTemplate(db, armazenamento, pronto.id);
    const outraZona = await configurarQrDoTemplate(db, pronto.id, { area: alterado && {
      x: alterado.qrXPt!, y: alterado.qrYPt!, largura: alterado.qrLarguraPt!, altura: alterado.qrAlturaPt!,
    }, zonaDeSilencioModulos: 2 });
    expect(outraZona.status).toBe("RASCUNHO");
    expect(outraZona.qrTestadoEm).toBeNull();
  });

  it("gravar a mesma configuração de novo não muda nada", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento);
    const igual = await configurarQrDoTemplate(db, pronto.id, AREA);
    expect(igual.status).toBe("PRONTO");
    expect(igual.qrTestadoEm?.getTime()).toBe(pronto.qrTestadoEm?.getTime());
  });

  it("recusa área fora da página, pequena demais e zona de silêncio menor que 2", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    const tentar = (entrada: unknown) => configurarQrDoTemplate(db, rascunho.id, entrada);
    expect((await erroDe(tentar({ area: { x: 350, y: 10, largura: 60, altura: 60 }, zonaDeSilencioModulos: 4 }))).message).toBe(
      "A área do QR Code deve ficar inteira dentro da página.",
    );
    expect((await erroDe(tentar({ area: { x: 10, y: 10, largura: 5, altura: 5 }, zonaDeSilencioModulos: 4 }))).message).toContain(
      "pelo menos 10 × 10 mm",
    );
    await expect(tentar({ area: AREA_DO_QR_NAS_FIXTURES, zonaDeSilencioModulos: 1 })).rejects.toThrow(
      "A zona de silêncio mínima é de 2 módulos.",
    );
    await expect(tentar({ area: { x: "10", y: 1, largura: 50, altura: 50 }, zonaDeSilencioModulos: 4 })).rejects.toThrow();
    expect((await recarregar(rascunho.id)).qrXPt).toBeNull();
  });

  it("não ativa se o arquivo sumiu do armazenamento", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    await configurarQrDoTemplate(db, rascunho.id, AREA);
    await testarQrDoTemplate(db, armazenamento, rascunho.id);
    await armazenamento.excluir(rascunho.chaveDoArquivo);
    expect((await erroDe(ativarTemplate(db, armazenamento, rascunho.id))).message).toContain("não está mais no armazenamento");
  });
});

describe("teste do QR", () => {
  it("usa a URL reservada de teste, que nunca é um cartão", async () => {
    const rascunho = await criarRascunho(db, armazenamento, { nome: "Google — Modelo 01" });
    await configurarQrDoTemplate(db, rascunho.id, AREA);

    const teste = await gerarPdfDeTeste(db, armazenamento, rascunho.id);
    expect(teste.urlDeTeste).toBe("https://go.example.com/c/TESTE0");
    expect(teste.nomeDoArquivo).toBe("teste-template-google-google-modelo-01.pdf");

    // O PDF de teste é o PDF enviado (mesma página, mesma arte) mais o QR de teste.
    const lido = await lerQrDaPagina(teste.pdf);
    expect(lido?.conteudo).toBe("https://go.example.com/c/TESTE0");
    const [original] = await lerPaginasDoPdf(lerFixture("template-google"));
    const [pagina] = await lerPaginasDoPdf(teste.pdf);
    expect(pagina.caixas).toEqual(original.caixas);
    expect(Buffer.from(pagina.conteudo[1].bytes).equals(Buffer.from(original.conteudo[0].bytes))).toBe(true);

    // Gerar o PDF de teste não marca o template como testado: só o teste explícito faz isso.
    expect((await recarregar(rascunho.id)).qrTestadoEm).toBeNull();
  });

  it("o código de teste não pode ser gerado, cadastrado nem resolvido como cartão", async () => {
    expect(CODIGO_DE_TESTE).toBe("TESTE0");
    expect(CODIGO_DE_TESTE).toHaveLength(6);
    expect(codigoValido(CODIGO_DE_TESTE)).toBe(false);
    await expect(criarCartaoComCodigo(db, CODIGO_DE_TESTE)).rejects.toThrow();
    // /c/TESTE0 responde "não encontrado", sem consultar cartão algum e sem redirecionar.
    expect(await resolverRedirecionamento(db, CODIGO_DE_TESTE)).toEqual({
      situacao: "NAO_ENCONTRADO",
      motivo: "CODIGO_INVALIDO",
    });
  });

  it("testar não cria nenhum cartão", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    await configurarQrDoTemplate(db, rascunho.id, AREA);
    await testarQrDoTemplate(db, armazenamento, rascunho.id);
    await gerarPdfDeTeste(db, armazenamento, rascunho.id);
    const { cartoes } = await import("@/db/schema");
    expect(await db.select().from(cartoes)).toHaveLength(0);
  });

  it("sem área do QR não há o que testar", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    expect((await erroDe(testarQrDoTemplate(db, armazenamento, rascunho.id))).message).toBe(
      "Configure a área do QR Code antes de testar.",
    );
  });

  it("interrompe a geração se o arquivo armazenado não for o registrado", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento);
    await armazenamento.excluir(pronto.chaveDoArquivo);
    await armazenamento.salvar(pronto.chaveDoArquivo, lerFixture("template-instagram"), "application/pdf");
    expect((await erroDe(gerarPdfDeTeste(db, armazenamento, pronto.id))).message).toContain(
      "não é o mesmo que foi registrado",
    );
  });
});

describe("padrão do produto", () => {
  it("só existe um padrão por produto; definir outro tira o anterior", async () => {
    const a = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 01", padrao: true });
    const b = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 02" });
    const insta = await criarTemplatePronto(db, armazenamento, { tipo: "INSTAGRAM", nome: "Instagram — Modelo 01", padrao: true });

    await definirTemplatePadrao(db, b.id, true);
    expect((await recarregar(a.id)).padrao).toBe(false);
    expect((await recarregar(b.id)).padrao).toBe(true);
    // O padrão do Instagram não é afetado pelo do Google.
    expect((await recarregar(insta.id)).padrao).toBe(true);

    // Ativar com “definir como padrão” também troca o padrão.
    const c = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 03", padrao: true });
    expect((await recarregar(b.id)).padrao).toBe(false);
    expect((await recarregar(c.id)).padrao).toBe(true);

    await definirTemplatePadrao(db, c.id, false);
    expect((await listarTemplates(db)).filter((t) => t.tipo === "GOOGLE" && t.padrao)).toEqual([]);
  });

  it("o banco impede dois padrões do mesmo produto", async () => {
    const a = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 01", padrao: true });
    const b = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 02" });
    await expect(
      db.update(templatesDeImpressao).set({ padrao: true }).where(eq(templatesDeImpressao.id, b.id)),
    ).rejects.toThrow();
    expect((await recarregar(a.id)).padrao).toBe(true);
  });

  it("rascunho e inativo não podem ser padrão; inativar tira o padrão", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    expect((await erroDe(definirTemplatePadrao(db, rascunho.id, true))).message).toBe(
      "Só um template pronto pode ser o padrão do produto.",
    );
    const pronto = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 02", padrao: true });
    const inativo = await inativarTemplate(db, pronto.id);
    expect(inativo.status).toBe("INATIVO");
    expect(inativo.padrao).toBe(false);
    expect((await erroDe(definirTemplatePadrao(db, pronto.id, true))).codigo).toBe("TEMPLATE_INVALIDO");

    // Reativar um inativo com o teste ainda válido volta direto para PRONTO.
    expect((await ativarTemplate(db, armazenamento, pronto.id)).status).toBe("PRONTO");
  });

  it("mudar o produto de um template tira o padrão do produto anterior", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento, { padrao: true });
    const mudado = await atualizarDadosDoTemplate(db, pronto.id, { nome: "Agora é Instagram", tipo: "INSTAGRAM" });
    expect(mudado.tipo).toBe("INSTAGRAM");
    expect(mudado.padrao).toBe(false);
    expect(mudado.status).toBe("PRONTO");
    await expect(atualizarDadosDoTemplate(db, pronto.id, { nome: "", tipo: "GOOGLE" })).rejects.toThrow(
      "Informe o nome do template.",
    );
    expect((await erroDe(atualizarDadosDoTemplate(db, pronto.id, { nome: "Sem produto", tipo: null }))).message).toBe(
      "Um template pronto precisa ter um produto.",
    );
  });
});

describe("lotes novos só usam template PRONTO do mesmo produto", () => {
  const novoLote = (templateId: string, tipo: "GOOGLE" | "INSTAGRAM" | null = "GOOGLE") =>
    criarLote(db, { quantidade: 2, tipo, descricao: null, templateId });

  it("rascunho e inativo são recusados no servidor", async () => {
    const rascunho = await criarRascunho(db, armazenamento, { nome: "Google — Rascunho" });
    expect((await erroDe(novoLote(rascunho.id))).message).toContain("ainda é um rascunho");

    const pronto = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 01" });
    await inativarTemplate(db, pronto.id);
    expect((await erroDe(novoLote(pronto.id))).message).toBe(
      "O template “Google — Modelo 01” está inativo e não pode ser usado em novos lotes.",
    );
    // Nenhum lote (nem cartão) foi criado pelas tentativas recusadas.
    expect(await db.select().from(lotes)).toHaveLength(0);
  });

  it("template de outro produto, lote sem produto e template inexistente são recusados", async () => {
    const google = await criarTemplatePronto(db, armazenamento);
    expect((await erroDe(novoLote(google.id, "INSTAGRAM"))).message).toContain("é de outro produto");
    expect((await erroDe(novoLote(google.id, null))).message).toContain("é de outro produto");
    expect((await erroDe(novoLote("00000000-0000-4000-8000-000000000000"))).codigo).toBe("TEMPLATE_NAO_ENCONTRADO");
    await expect(novoLote("não-é-uuid")).rejects.toThrow("Template de impressão inválido.");
  });

  it("só os PRONTOS são oferecidos, com o padrão primeiro", async () => {
    await criarRascunho(db, armazenamento, { nome: "Rascunho" });
    const b = await criarTemplatePronto(db, armazenamento, { nome: "B — pronto" });
    const a = await criarTemplatePronto(db, armazenamento, { nome: "A — pronto" });
    const inativo = await criarTemplatePronto(db, armazenamento, { nome: "C — inativo" });
    await inativarTemplate(db, inativo.id);
    await definirTemplatePadrao(db, b.id, true);

    expect((await listarTemplatesParaNovosLotes(db)).map((t) => t.nome)).toEqual(["B — pronto", "A — pronto"]);
    expect(a.status).toBe("PRONTO");
  });

  it("criar o lote grava o template e o SHA-256, e bloqueia o template", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento);
    expect(pronto.bloqueadoEm).toBeNull();

    const { lote } = await novoLote(pronto.id);
    expect(lote.templateId).toBe(pronto.id);
    expect(lote.templateSha256).toBe(pronto.sha256);
    expect((await recarregar(pronto.id)).bloqueadoEm).not.toBeNull();

    // Um lote sem template continua existindo (caminho anterior), sem tocar em template algum.
    const semTemplate = await criarLote(db, { quantidade: 1, tipo: "GOOGLE", descricao: null });
    expect(semTemplate.lote.templateId).toBeNull();
    expect(semTemplate.lote.templateSha256).toBeNull();
  });
});

describe("template bloqueado (usado por um lote)", () => {
  async function templateEmUso() {
    const pronto = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 01", padrao: true });
    const { lote } = await criarLote(db, { quantidade: 2, tipo: "GOOGLE", descricao: null, templateId: pronto.id });
    return { template: await recarregar(pronto.id), lote };
  }

  it("recusa mudança de área do QR, de arquivo e de produto", async () => {
    const { template } = await templateEmUso();

    const erroDeQr = await erroDe(
      configurarQrDoTemplate(db, template.id, { area: { ...AREA_DO_QR_NAS_FIXTURES, y: 30 }, zonaDeSilencioModulos: 4 }),
    );
    expect(erroDeQr.codigo).toBe("TEMPLATE_BLOQUEADO");
    expect(erroDeQr.message).toContain("Duplicar como nova versão");

    const novaChave = await enviarArquivo(armazenamento, lerFixture("template-instagram"));
    const erroDeArquivo = await erroDe(
      substituirArquivoDoTemplate(db, armazenamento, template.id, { chave: novaChave, nomeOriginal: "nova.pdf" }),
    );
    expect(erroDeArquivo.codigo).toBe("TEMPLATE_BLOQUEADO");
    // O arquivo recusado não fica órfão, e o original continua lá, intacto.
    expect(armazenamento.chaves()).toEqual([template.chaveDoArquivo]);
    expect(await armazenamento.ler(template.chaveDoArquivo)).toEqual(lerFixture("template-google"));

    expect((await erroDe(atualizarDadosDoTemplate(db, template.id, { nome: "X", tipo: "INSTAGRAM" }))).codigo).toBe(
      "TEMPLATE_BLOQUEADO",
    );

    const depois = await recarregar(template.id);
    expect(depois.status).toBe("PRONTO");
    expect(depois.sha256).toBe(template.sha256);
    expect(depois.qrYPt).toBe(template.qrYPt);
    expect(depois.qrTestadoEm?.getTime()).toBe(template.qrTestadoEm?.getTime());
  });

  it("continua permitindo renomear, definir/retirar padrão e inativar", async () => {
    const { template } = await templateEmUso();
    expect((await atualizarDadosDoTemplate(db, template.id, { nome: "Google — Verão", tipo: "GOOGLE" })).nome).toBe(
      "Google — Verão",
    );
    expect((await definirTemplatePadrao(db, template.id, false)).padrao).toBe(false);
    expect((await definirTemplatePadrao(db, template.id, true)).padrao).toBe(true);
    expect((await inativarTemplate(db, template.id)).status).toBe("INATIVO");
    expect((await ativarTemplate(db, armazenamento, template.id)).status).toBe("PRONTO");
  });

  it("“Duplicar como nova versão” cria um rascunho com a mesma arte e a mesma área do QR", async () => {
    const { template } = await templateEmUso();
    const copia = await duplicarTemplate(db, armazenamento, template.id);

    expect(copia.id).not.toBe(template.id);
    expect(copia.nome).toBe("Google — Modelo 02");
    expect(copia.status).toBe("RASCUNHO");
    expect(copia.padrao).toBe(false);
    expect(copia.bloqueadoEm).toBeNull();
    expect(copia.qrTestadoEm).toBeNull();
    expect(copia.tipo).toBe("GOOGLE");
    expect([copia.qrXPt, copia.qrYPt, copia.qrLarguraPt, copia.qrAlturaPt]).toEqual([
      template.qrXPt,
      template.qrYPt,
      template.qrLarguraPt,
      template.qrAlturaPt,
    ]);
    // A cópia tem o seu próprio arquivo no armazenamento, com o mesmo conteúdo.
    expect(copia.chaveDoArquivo).not.toBe(template.chaveDoArquivo);
    expect(copia.sha256).toBe(template.sha256);
    expect(await armazenamento.ler(copia.chaveDoArquivo)).toEqual(await armazenamento.ler(template.chaveDoArquivo));

    // A nova versão aceita outra arte e outra posição do QR; a original não muda.
    const novaChave = await enviarArquivo(armazenamento, lerFixture("template-instagram"));
    const comNovaArte = await substituirArquivoDoTemplate(db, armazenamento, copia.id, {
      chave: novaChave,
      nomeOriginal: "google_v2.pdf",
    });
    expect(comNovaArte.sha256).toBe(calcularSha256(lerFixture("template-instagram")));
    expect(comNovaArte.chaveDoArquivo).toBe(novaChave);
    expect(comNovaArte.arquivoNomeOriginal).toBe("google_v2.pdf");
    // A área copiada ainda cabe na nova página, então é mantida; o teste precisa ser refeito.
    expect(comNovaArte.qrXPt).toBe(template.qrXPt);
    expect(comNovaArte.qrTestadoEm).toBeNull();
    // O arquivo antigo da cópia foi apagado; o do template original continua.
    expect(armazenamento.chaves()).toEqual([template.chaveDoArquivo, novaChave].sort());
    expect((await recarregar(template.id)).sha256).toBe(template.sha256);

    await configurarQrDoTemplate(db, copia.id, { area: { ...AREA_DO_QR_NAS_FIXTURES, y: 40 }, zonaDeSilencioModulos: 3 });
    await testarQrDoTemplate(db, armazenamento, copia.id);
    expect((await ativarTemplate(db, armazenamento, copia.id, { definirComoPadrao: true })).status).toBe("PRONTO");
    expect((await recarregar(template.id)).padrao).toBe(false);
  });

  it("a exclusão é bloqueada enquanto um lote usa o template; inativar é o caminho", async () => {
    const { template, lote } = await templateEmUso();
    const erro = await erroDe(excluirTemplate(db, armazenamento, template.id));
    expect(erro.codigo).toBe("TEMPLATE_BLOQUEADO");
    expect(erro.message).toContain("inative-o");
    expect(await buscarTemplate(db, template.id)).not.toBeNull();
    expect(await armazenamento.existe(template.chaveDoArquivo)).toBe(true);

    // O banco também impede (chave estrangeira com RESTRICT).
    await expect(db.delete(templatesDeImpressao).where(eq(templatesDeImpressao.id, template.id))).rejects.toThrow();

    const [naLista] = await listarTemplates(db);
    expect(naLista.lotes).toBe(1);

    // Depois de apagar o lote, o template volta a poder ser editado e excluído.
    await excluirLote(db, lote.identificador, lote.identificador);
    expect((await recarregar(template.id)).bloqueadoEm).toBeNull();
    await excluirTemplate(db, armazenamento, template.id);
    expect(await buscarTemplate(db, template.id)).toBeNull();
    expect(armazenamento.chaves()).toEqual([]);
  });

  it("com dois lotes, apagar um não desbloqueia o template", async () => {
    const { template, lote } = await templateEmUso();
    await criarLote(db, { quantidade: 1, tipo: "GOOGLE", descricao: null, templateId: template.id });
    await excluirLote(db, lote.identificador, lote.identificador);
    expect((await recarregar(template.id)).bloqueadoEm).not.toBeNull();
    expect((await listarTemplates(db))[0].lotes).toBe(1);
  });
});

describe("template ainda não usado", () => {
  it("pode ser excluído: registro e arquivo somem", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    await excluirTemplate(db, armazenamento, rascunho.id);
    expect(await listarTemplates(db)).toEqual([]);
    expect(armazenamento.chaves()).toEqual([]);
    expect((await erroDe(excluirTemplate(db, armazenamento, rascunho.id))).codigo).toBe("TEMPLATE_NAO_ENCONTRADO");
  });

  it("trocar a arte grava um arquivo novo (nunca sobrescreve) e invalida o teste", async () => {
    const pronto = await criarTemplatePronto(db, armazenamento, { padrao: true });
    // Nova arte com página menor: a área do QR antiga não cabe mais e é descartada.
    const menor = criarPdfDeTemplate({ larguraMm: 60, alturaMm: 60 });
    const chave = await enviarArquivo(armazenamento, menor.bytes);
    const trocado = await substituirArquivoDoTemplate(db, armazenamento, pronto.id, { chave, nomeOriginal: "menor.pdf" });

    expect(trocado.chaveDoArquivo).toBe(chave);
    expect(trocado.chaveDoArquivo).not.toBe(pronto.chaveDoArquivo);
    expect(trocado.status).toBe("RASCUNHO");
    expect(trocado.padrao).toBe(false);
    expect(trocado.qrXPt).toBeNull();
    expect(trocado.qrTestadoEm).toBeNull();
    expect(trocado.larguraDaPaginaMm).toBeCloseTo(60, 2);
    expect(armazenamento.chaves()).toEqual([chave]);

    // Arte inválida no lugar: recusada, apagada, e o template continua com a arte atual.
    const ruim = await enviarArquivo(armazenamento, lerFixture("duas-paginas"));
    await erroDe(substituirArquivoDoTemplate(db, armazenamento, pronto.id, { chave: ruim, nomeOriginal: "ruim.pdf" }));
    expect(armazenamento.chaves()).toEqual([chave]);
    expect((await recarregar(pronto.id)).chaveDoArquivo).toBe(chave);
  });

  it("identificadores inválidos não chegam ao banco", async () => {
    expect(await buscarTemplate(db, "'; drop table lotes; --")).toBeNull();
    expect((await erroDe(inativarTemplate(db, "abc"))).codigo).toBe("TEMPLATE_NAO_ENCONTRADO");
    expect((await erroDe(duplicarTemplate(db, armazenamento, "00000000-0000-4000-8000-000000000000"))).codigo).toBe(
      "TEMPLATE_NAO_ENCONTRADO",
    );
  });
});

describe("nome da nova versão", () => {
  it("incrementa o número final e evita nomes já usados", () => {
    expect(nomeDaNovaVersao("Google — Modelo 01", [])).toBe("Google — Modelo 02");
    expect(nomeDaNovaVersao("Google — Modelo 01", ["Google — Modelo 02", "google — modelo 03"])).toBe("Google — Modelo 04");
    expect(nomeDaNovaVersao("Instagram 9", [])).toBe("Instagram 10");
    expect(nomeDaNovaVersao("Cartão azul", [])).toBe("Cartão azul (nova versão)");
    expect(nomeDaNovaVersao("Cartão azul", ["Cartão azul (nova versão)"])).toBe("Cartão azul (nova versão 2)");
    expect(nomeDaNovaVersao("x".repeat(80), []).length).toBeLessThanOrEqual(80);
  });
});

describe("desenho do teste", () => {
  it("o QR do teste fica na área configurada", async () => {
    const rascunho = await criarRascunho(db, armazenamento);
    await configurarQrDoTemplate(db, rascunho.id, AREA);
    const { pdf } = await gerarPdfDeTeste(db, armazenamento, rascunho.id);
    const [desenho] = await lerDesenhosDoQr(pdf);
    expect(desenho.fundo.x).toBeCloseTo(AREA_DO_QR_NAS_FIXTURES.x, 3);
    expect(desenho.fundo.largura).toBeCloseTo(AREA_DO_QR_NAS_FIXTURES.largura, 3);
    expect(desenho.conteudo).toBe("https://go.example.com/c/TESTE0");
  });
});
