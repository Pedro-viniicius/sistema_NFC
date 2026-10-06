// Demonstração final dos templates de impressão, de ponta a ponta, com um template "Google" e um
// "Instagram": envio → dimensões → área do QR → teste → ativação → lote com o cartão K8M4T2 →
// PDF de impressão → troca de destino → o QR continua o mesmo.
import { beforeAll, describe, expect, it } from "vitest";
import type { Banco } from "@/db/tipos";
import { criarLote } from "@/modules/batches/servico";
import { configurarDestino } from "@/modules/cards/servico";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { gerarArquivoDeImpressaoDoCartao } from "@/modules/printing/servico";
import { ArmazenamentoEmMemoria } from "@/modules/storage/memoria";
import { areaAPartirDeMm } from "@/modules/templates/coordenadas";
import {
  buscarTemplateDoLote,
  gerarCsvDeControleComTemplate,
  planejarPacoteComTemplate,
} from "@/modules/templates/producao";
import {
  ativarTemplate,
  atualizarDadosDoTemplate,
  configurarQrDoTemplate,
  gerarPdfDeTeste,
  registrarTemplateEnviado,
  testarQrDoTemplate,
  visaoDoTemplate,
} from "@/modules/templates/servico";
import { descreverPdfDoTemplate } from "@/modules/templates/validacao-do-pdf";
import { criarBancoDeTeste } from "./banco-de-teste";
import { lerFixture } from "./fixtures-de-template";
import { lerPaginasDoPdf } from "./ler-pdf-de-template";
import { ESPACO_DO_QR_MM } from "./pdf-de-template";
import { lerQrDaPagina, regiaoDiferente, renderizarPagina } from "./renderizar-pdf";
import { enviarArquivo } from "./templates-de-teste";

const CODIGO = "K8M4T2";
const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";

const CASOS = [
  { produto: "GOOGLE", fixture: "template-google", nome: "Google — Modelo 01", arquivo: "google-K8M4T2.pdf", destino: "https://g.page/r/cliente/review" },
  { produto: "INSTAGRAM", fixture: "template-instagram", nome: "Instagram — Modelo 01", arquivo: "instagram-K8M4T2.pdf", destino: "https://www.instagram.com/cliente" },
] as const;

describe.each(CASOS)("template $nome", ({ produto, fixture, nome, arquivo, destino }) => {
  let db: Banco;
  const armazenamento = new ArmazenamentoEmMemoria();
  let id: string;

  beforeAll(async () => {
    db = await criarBancoDeTeste();
  });

  it("1–2. envia o PDF e confere as dimensões detectadas", async () => {
    const chave = await enviarArquivo(armazenamento, lerFixture(fixture));
    const rascunho = await registrarTemplateEnviado(db, armazenamento, { chave, nomeOriginal: `${fixture}.pdf` });
    id = rascunho.id;
    expect(descreverPdfDoTemplate(rascunho)).toBe(`${fixture}.pdf · 1 página · 130,05 × 86,70 mm · paisagem`);
    await atualizarDadosDoTemplate(db, id, { nome, tipo: produto });
  });

  it("3–4. configura a área do QR sobre o espaço em branco da arte (medidas em mm, a partir do topo)", async () => {
    const rascunho = await atualizarDadosDoTemplate(db, id, { nome, tipo: produto });
    const area = areaAPartirDeMm(ESPACO_DO_QR_MM, visaoDoTemplate(rascunho));
    const configurado = await configurarQrDoTemplate(db, id, { area, zonaDeSilencioModulos: 4 });
    // Só pontos são gravados: 80,5 mm da esquerda; base a 86,70 − 22 − 34 = 30,70 mm da base da página.
    expect(configurado.qrXPt).toBeCloseTo((80.5 * 72) / 25.4, 6);
    // (A página da arte mede 245,764 pt, arredondados no arquivo: daí a tolerância de milésimos de ponto.)
    expect(configurado.qrYPt).toBeCloseTo((30.7 * 72) / 25.4, 3);
    expect(configurado.qrLarguraPt).toBeCloseTo((34 * 72) / 25.4, 6);
  });

  it("5–6. testa o QR e baixa o PDF de teste", async () => {
    await testarQrDoTemplate(db, armazenamento, id);
    const teste = await gerarPdfDeTeste(db, armazenamento, id);
    expect(teste.nomeDoArquivo).toMatch(/^teste-template-(google|instagram)-.+-modelo-01\.pdf$/);
    expect((await lerQrDaPagina(teste.pdf))?.conteudo).toBe("https://go.example.com/c/TESTE0");
  });

  it("7. ativa o template", async () => {
    const pronto = await ativarTemplate(db, armazenamento, id, { definirComoPadrao: true });
    expect(pronto.status).toBe("PRONTO");
    expect(pronto.padrao).toBe(true);
  });

  it("cartão K8M4T2: arte e página preservadas, QR no espaço em branco, lido como a URL permanente", async () => {
    const codigos = [CODIGO, "7PN3RX"];
    const { lote } = await criarLote(
      db,
      { quantidade: 2, tipo: produto, descricao: null, templateId: id },
      { gerarCodigo: () => codigos.shift() ?? "ZZZZZ9" },
    );
    expect(getCardPublicUrl(CODIGO)).toBe(URL_PERMANENTE);

    const original = lerFixture(fixture);
    const impressao = await gerarArquivoDeImpressaoDoCartao(db, CODIGO, null, () => armazenamento);
    expect(impressao.nomeDoArquivo).toBe(arquivo);

    // Arte original preservada: mesmos bytes de conteúdo e de imagem, mesmas caixas de página.
    const [paginaOriginal] = await lerPaginasDoPdf(original);
    const [pagina] = await lerPaginasDoPdf(impressao.pdf);
    expect(pagina.caixas).toEqual(paginaOriginal.caixas);
    expect(Buffer.from(pagina.conteudo[1].bytes).equals(Buffer.from(paginaOriginal.conteudo[0].bytes))).toBe(true);
    expect(Buffer.from(pagina.xobjects[0].bytes).equals(Buffer.from(paginaOriginal.xobjects[0].bytes))).toBe(true);

    // QR dentro da área em branco configurada: é a única região da página que muda.
    const template = await buscarTemplateDoLote(db, lote);
    const area = areaAPartirDeMm(ESPACO_DO_QR_MM, visaoDoTemplate(template!));
    const mudou = regiaoDiferente(await renderizarPagina(original), await renderizarPagina(impressao.pdf));
    expect(mudou!.x).toBeGreaterThanOrEqual(area.x - 0.25);
    expect(mudou!.y).toBeGreaterThanOrEqual(area.y - 0.25);
    expect(mudou!.x + mudou!.largura).toBeLessThanOrEqual(area.x + area.largura + 0.25);
    expect(mudou!.y + mudou!.altura).toBeLessThanOrEqual(area.y + area.altura + 0.25);

    // O QR, lido da página renderizada, é a URL permanente — a mesma do NFC.
    expect((await lerQrDaPagina(impressao.pdf))?.conteudo).toBe(URL_PERMANENTE);
    const pacote = planejarPacoteComTemplate(lote, [CODIGO, "7PN3RX"], template!);
    const [, linha] = gerarCsvDeControleComTemplate(pacote).split("\r\n");
    const [, , , , urlPermanente, urlNfc, urlQr] = linha.split(",");
    expect([urlPermanente, urlNfc, urlQr]).toEqual([URL_PERMANENTE, URL_PERMANENTE, URL_PERMANENTE]);
  });

  it("trocar o destino do cartão não muda o QR: o PDF regerado é idêntico", async () => {
    const antes = await gerarArquivoDeImpressaoDoCartao(db, CODIGO, null, () => armazenamento);
    await configurarDestino(db, { codigo: CODIGO, tipo: produto, destinoUrl: destino, ativar: true });
    const depois = await gerarArquivoDeImpressaoDoCartao(db, CODIGO, null, () => armazenamento);

    expect(Buffer.from(depois.pdf).equals(Buffer.from(antes.pdf))).toBe(true);
    expect((await lerQrDaPagina(depois.pdf))?.conteudo).toBe(URL_PERMANENTE);
    expect(Buffer.from(depois.pdf).toString("latin1")).not.toContain(new URL(destino).hostname);
  });
});
