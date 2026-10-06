import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { gerarCodigo } from "@/modules/cards/codigo";
import { criarCartaoComCodigo, configurarDestino } from "@/modules/cards/servico";
import { criarArteDeTeste } from "../../../tests/artes-de-teste";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { lerArteDoModelo, lerPdfDeImpressao } from "../../../tests/ler-pdf";
import {
  CODIGO_DE_AMOSTRA,
  TAMANHO_MAXIMO_DA_ARTE_BYTES,
  listarSituacaoDasArtes,
  obterModeloEfetivo,
  removerArte,
  salvarArte,
  type NovaArte,
} from "./artes";
import { geometriaDoModelo, obterModelo, type ModeloDeImpressao } from "./modelos";
import { gerarPdfDoCartao } from "./pdf";
import { gerarZipDoPacote, planejarPacote } from "./producao";
import { gerarArteDoCartao } from "./servico";
import { mmParaPontos, pontosParaMm } from "./unidades";

const google = obterModelo("GOOGLE") as ModeloDeImpressao;
const instagram = obterModelo("INSTAGRAM") as ModeloDeImpressao;
const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";

let db: Banco;

beforeEach(async () => {
  db = await criarBancoDeTeste();
});

async function novaArte(extra: Partial<NovaArte> = {}, opcoes: Parameters<typeof criarArteDeTeste>[0] = {}): Promise<NovaArte> {
  return {
    bytes: await criarArteDeTeste(opcoes),
    nomeDoArquivo: "arte-do-designer.pdf",
    qrXMm: 50,
    qrYMm: 6,
    qrTamanhoMm: 30,
    corDoCodigo: "preto",
    ...extra,
  };
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeDominio> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeDominio) return erro;
    throw erro;
  }
  throw new Error("Esperava um ErroDeDominio.");
}

describe("envio de arte pelo painel", () => {
  it("sem arte enviada, o modelo usa a arte padrão do sistema", async () => {
    expect(await obterModeloEfetivo(db, google)).toBe(google);
    const situacoes = await listarSituacaoDasArtes(db);
    expect(situacoes.map((s) => [s.base.slug, s.enviada])).toEqual([
      ["google", null],
      ["instagram", null],
    ]);
  });

  it("a arte enviada passa a ser usada nos PDFs daquele modelo, e só dele", async () => {
    const arte = await novaArte();
    const { comSangria } = await salvarArte(db, google, arte);
    expect(comSangria).toBe(true);

    const efetivo = await obterModeloEfetivo(db, google);
    expect(efetivo.arteEnviada?.nomeDoArquivo).toBe("arte-do-designer.pdf");
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", efetivo));
    expect(pagina.arteEmbutida).toContain((await lerArteDoModelo(arte.bytes)).trim());
    expect(pagina.conteudoDoQr).toBe(URL_PERMANENTE);

    expect(await obterModeloEfetivo(db, instagram)).toBe(instagram);
    const [situacaoGoogle, situacaoInstagram] = await listarSituacaoDasArtes(db);
    expect(situacaoGoogle.enviada?.tamanhoBytes).toBe(arte.bytes.length);
    expect(situacaoInstagram.enviada).toBeNull();
  });

  it("respeita a posição e o tamanho do QR informados no envio", async () => {
    await salvarArte(db, google, await novaArte({ qrXMm: 8, qrYMm: 10, qrTamanhoMm: 26 }));
    const efetivo = await obterModeloEfetivo(db, google);
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", efetivo));

    expect(pontosParaMm(pagina.areaDoQr.x)).toBeCloseTo(3 + 8, 4);
    expect(pontosParaMm(pagina.areaDoQr.y)).toBeCloseTo(3 + 54 - 10 - 26, 4);
    expect(pontosParaMm(pagina.areaDoQr.largura)).toBeCloseTo(26, 4);
    expect(pagina.zonaDeSilencioEmModulos).toBe(4);
    expect(pagina.conteudoDoQr).toBe(URL_PERMANENTE);
    // O código acompanha o QR: centralizado logo abaixo dele.
    expect(efetivo.codigo).toEqual({ xCentroMm: 21, linhaDeBaseMm: 40.2, tamanhoPt: 6.5, cor: "preto" });
  });

  it("permite não imprimir o código do cartão", async () => {
    await salvarArte(db, google, await novaArte({ corDoCodigo: null }));
    const efetivo = await obterModeloEfetivo(db, google);
    expect(efetivo.codigo).toBeNull();
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", efetivo));
    expect(pagina.operadores.slice(pagina.operadores.indexOf("EMC") + 3).trim()).toBe("");
  });

  it("aceita arte no tamanho final (sem sangria) e a posiciona dentro do corte, sem redimensionar", async () => {
    const { comSangria } = await salvarArte(db, google, await novaArte({}, { larguraMm: 86, alturaMm: 54 }));
    expect(comSangria).toBe(false);

    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", await obterModeloEfetivo(db, google)));
    expect(pontosParaMm(pagina.midia.largura)).toBeCloseTo(92, 4);
    expect(pontosParaMm(pagina.midia.altura)).toBeCloseTo(60, 4);
    expect(pontosParaMm(pagina.corte.largura)).toBeCloseTo(86, 4);
    // A arte é desenhada em escala 1, deslocada pela sangria (matriz "1 0 0 1 x y cm").
    const matriz = /1 0 0 1 ([\d.]+) ([\d.]+) cm/.exec(pagina.operadores);
    expect(Number(matriz?.[1])).toBeCloseTo(mmParaPontos(3), 3);
    expect(Number(matriz?.[2])).toBeCloseTo(mmParaPontos(3), 3);
    expect(pagina.areaDoQr.x).toBeCloseTo(geometriaDoModelo(google).qr.x, 4);
  });

  it("uma nova arte substitui a anterior; restaurar volta à arte padrão", async () => {
    await salvarArte(db, google, await novaArte({ nomeDoArquivo: "primeira.pdf" }));
    await salvarArte(db, google, await novaArte({ nomeDoArquivo: "segunda.pdf" }, { ciano: 0.9 }));
    expect((await obterModeloEfetivo(db, google)).arteEnviada?.nomeDoArquivo).toBe("segunda.pdf");
    expect((await listarSituacaoDasArtes(db)).filter((s) => s.enviada)).toHaveLength(1);

    expect(await removerArte(db, google)).toBe(true);
    expect(await removerArte(db, google)).toBe(false);
    expect(await obterModeloEfetivo(db, google)).toBe(google);
  });

  it("limpa o nome do arquivo exibido", async () => {
    await salvarArte(db, google, await novaArte({ nomeDoArquivo: '../<script>"arte".pdf' }));
    expect((await obterModeloEfetivo(db, google)).arteEnviada?.nomeDoArquivo).toBe("..scriptarte.pdf");
  });
});

describe("arte recusada: nada é salvo", () => {
  async function recusada(arte: NovaArte): Promise<string> {
    const erro = await erroDe(salvarArte(db, google, arte));
    expect(await obterModeloEfetivo(db, google)).toBe(google);
    return erro.message;
  }

  it("arquivo que não é PDF, vazio ou grande demais", async () => {
    expect(await recusada(await novaArte({ bytes: new TextEncoder().encode("<html>não é pdf</html>") }))).toBe(
      "O arquivo enviado não é um PDF.",
    );
    expect(await recusada(await novaArte({ bytes: new Uint8Array() }))).toContain("Selecione o arquivo");
    const grande = new Uint8Array(TAMANHO_MAXIMO_DA_ARTE_BYTES + 1);
    expect(await recusada(await novaArte({ bytes: grande }))).toContain("O limite é 2,0 MB");
  });

  it("PDF corrompido", async () => {
    const corrompido = new TextEncoder().encode("%PDF-1.7\nisto não é um pdf de verdade");
    expect(await recusada(await novaArte({ bytes: corrompido }))).toContain("não é um PDF válido");
  });

  it("PDF com mais de uma página", async () => {
    expect(await recusada(await novaArte({}, { paginas: 2 }))).toContain("exatamente uma página (tem 2)");
  });

  it("PDF em tamanho diferente (ex.: A4), informando os tamanhos aceitos", async () => {
    const mensagem = await recusada(await novaArte({}, { larguraMm: 210, alturaMm: 297 }));
    expect(mensagem).toContain("mede 210,00 × 297,00 mm");
    expect(mensagem).toContain("92,00 × 60,00 mm (com sangria) ou 86,00 × 54,00 mm (sem sangria)");
  });

  it("QR fora da arte, pequeno demais para leitura ou sem espaço para o código", async () => {
    expect(await recusada(await novaArte({ qrXMm: 70 }))).toContain("não cabe");
    expect(await recusada(await novaArte({ qrTamanhoMm: 12 }))).toContain("módulos menores que 0.5 mm");
    expect(await recusada(await novaArte({ qrYMm: 20 }))).toContain("Não há espaço para o código");
    // O mesmo QR é aceito quando o código não é impresso.
    await salvarArte(db, google, await novaArte({ qrYMm: 20, corDoCodigo: null }));
  });

  it("medidas inválidas", async () => {
    const invalida = { ...(await novaArte()), qrTamanhoMm: "abc" as unknown as number };
    await expect(salvarArte(db, google, invalida)).rejects.toThrow();
    expect(await obterModeloEfetivo(db, google)).toBe(google);
  });
});

describe("arte enviada e o invariante do QR", () => {
  it("K8M4T2 com arte enviada: trocar o destino não muda o QR do PDF", async () => {
    await salvarArte(db, google, await novaArte());
    await criarCartaoComCodigo(db, "K8M4T2", { tipo: "GOOGLE" });
    await configurarDestino(db, { codigo: "K8M4T2", tipo: "GOOGLE", destinoUrl: "https://g.page/r/customer/review" });

    const antes = await gerarArteDoCartao(db, "K8M4T2");
    expect(antes.modelo.arteEnviada?.nomeDoArquivo).toBe("arte-do-designer.pdf");
    expect((await lerPdfDeImpressao(antes.pdf))[0].conteudoDoQr).toBe(URL_PERMANENTE);

    await configurarDestino(db, { codigo: "K8M4T2", tipo: "GOOGLE", destinoUrl: "https://g.page/r/outro/review" });
    const depois = await gerarArteDoCartao(db, "K8M4T2");
    const [paginaAntes] = await lerPdfDeImpressao(antes.pdf);
    const [paginaDepois] = await lerPdfDeImpressao(depois.pdf);
    expect(paginaDepois.conteudoDoQr).toBe(URL_PERMANENTE);
    expect(paginaDepois.operadores).toBe(paginaAntes.operadores);
  });

  it("a amostra usa um código fictício válido", async () => {
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao(CODIGO_DE_AMOSTRA, google));
    expect(pagina.conteudoDoQr).toBe("https://go.example.com/c/AMSTRA");
  });
});

describe("tamanho do PDF gerado", () => {
  it("o cartão não carrega a arte em dobro: o PDF fica pouco maior que a própria arte", async () => {
    const arte = await novaArte({}, { formas: 7000 });
    await salvarArte(db, google, arte);
    const pdf = await gerarPdfDoCartao("K8M4T2", await obterModeloEfetivo(db, google));
    expect(arte.bytes.length).toBeGreaterThan(150 * 1024);
    expect(pdf.length).toBeLessThan(arte.bytes.length * 1.2);

    const [pagina] = await lerPdfDeImpressao(pdf);
    expect(pagina.conteudoDoQr).toBe(URL_PERMANENTE);
    expect(pagina.arteEmbutida).toContain((await lerArteDoModelo(arte.bytes)).trim());
  });

  it("com a arte padrão, o cartão também não carrega conteúdo sem uso", async () => {
    const pdf = await gerarPdfDoCartao("K8M4T2", google);
    expect(pdf.length).toBeLessThan(13 * 1024);
  });
});

describe("pacote com arte pesada", () => {
  function codigosUnicos(quantidade: number): string[] {
    const codigos = new Set<string>();
    while (codigos.size < quantidade) codigos.add(gerarCodigo());
    return [...codigos];
  }

  it("omite os PDFs individuais quando eles não cabem no pacote, e avisa no LEIA-ME", async () => {
    await salvarArte(db, google, await novaArte({}, { formas: 7000 }));
    const modelo = await obterModeloEfetivo(db, google);
    const pacote = await planejarPacote({
      identificadorDoLote: "lote-2026-001",
      codigos: codigosUnicos(100),
      modelo,
    });

    const zipBytes = await gerarZipDoPacote(pacote);
    expect(zipBytes.byteLength).toBeLessThan(4 * 1024 * 1024);

    const zip = await JSZip.loadAsync(zipBytes);
    const nomes = Object.values(zip.files).filter((arquivo) => !arquivo.dir).map((arquivo) => arquivo.name);
    expect(nomes.filter((nome) => nome.includes("/individuais/"))).toHaveLength(0);
    expect(nomes.filter((nome) => nome.includes("/qr/"))).toHaveLength(100);
    expect(nomes).toContain("lote-2026-001-google/lote-2026-001-google.pdf");
    expect(nomes).toContain("lote-2026-001-google/controle.csv");
    const leiaMe = await zip.file("lote-2026-001-google/LEIA-ME.txt")?.async("string");
    expect(leiaMe).toContain("sem PDFs individuais");

    // Com poucos cartões, a mesma arte cabe e os individuais voltam.
    const pequeno = await planejarPacote({ identificadorDoLote: "lote-2026-002", codigos: codigosUnicos(3), modelo });
    const zipPequeno = await JSZip.loadAsync(await gerarZipDoPacote(pequeno));
    expect(Object.keys(zipPequeno.files).filter((nome) => /individuais\/.+\.pdf$/.test(nome))).toHaveLength(3);
  });
});
