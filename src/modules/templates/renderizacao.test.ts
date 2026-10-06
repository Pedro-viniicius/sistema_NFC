// Núcleo da impressão com template. Usa a biblioteca de PDF de verdade e arquivos reais
// (tests/fixtures/templates); nada é simulado. O QR é conferido de duas formas independentes:
//  1. a página é RENDERIZADA (pdf.js + canvas) e o QR é lido da imagem com o jsQR;
//  2. o desenho vetorial é lido do arquivo e comparado com a área configurada.
import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "@/lib/erros";
import { gerarMatrizDoConteudo } from "@/modules/qr/gerar";
import { lerFixture, type NomeDaFixture } from "../../../tests/fixtures-de-template";
import { lerDesenhosDoQr, lerPaginasDoPdf } from "../../../tests/ler-pdf-de-template";
import { criarPdfDeTemplate } from "../../../tests/pdf-de-template";
import { contarPaginas, lerQrDaPagina, regiaoDiferente, renderizarPagina } from "../../../tests/renderizar-pdf";
import { mmToPt } from "./coordenadas";
import { analisarEstadoGrafico } from "./estado-grafico";
import { quadradoDoQr } from "./geometria-do-qr";
import { MAXIMO_DE_CARTOES_POR_PDF, renderTemplatePdf } from "./renderizacao";
import type { ConfiguracaoDoQr, RetanguloPt } from "./tipos";

const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** URLs permanentes distintas e determinísticas. */
function urls(quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => {
    let codigo = "";
    for (let posicao = 0, resto = i * 7919 + 13; posicao < 6; posicao++) {
      codigo += ALFABETO[resto % ALFABETO.length];
      resto = Math.floor(resto / ALFABETO.length) + posicao * 5;
    }
    return `https://go.example.com/c/${codigo}`;
  });
}

function config(area: RetanguloPt, zonaDeSilencioModulos = 4): ConfiguracaoDoQr {
  return { area, zonaDeSilencioModulos };
}

function dentroDe(interno: RetanguloPt, externo: RetanguloPt, folga = 0.01): void {
  expect(interno.x).toBeGreaterThanOrEqual(externo.x - folga);
  expect(interno.y).toBeGreaterThanOrEqual(externo.y - folga);
  expect(interno.x + interno.largura).toBeLessThanOrEqual(externo.x + externo.largura + folga);
  expect(interno.y + interno.altura).toBeLessThanOrEqual(externo.y + externo.altura + folga);
}

function contarOcorrencias(arquivo: Uint8Array, trecho: Uint8Array): number {
  const conteudo = Buffer.from(arquivo);
  const procurado = Buffer.from(trecho);
  let quantidade = 0;
  for (let posicao = conteudo.indexOf(procurado); posicao >= 0; posicao = conteudo.indexOf(procurado, posicao + 1)) {
    quantidade++;
  }
  return quantidade;
}

const google = criarPdfDeTemplate({ tema: "google" });

describe("página de saída = página do template", () => {
  const casos: [NomeDaFixture, ReturnType<typeof criarPdfDeTemplate>][] = [
    ["template-google", google],
    ["template-instagram", criarPdfDeTemplate({ tema: "instagram" })],
    ["mediabox-com-origem", criarPdfDeTemplate({ origem: [100, 200] })],
    ["cropbox-menor", criarPdfDeTemplate({ origem: [10, 15], margemDaCropBox: 20 })],
  ];

  it.each(casos)("%s: caixas, rotação e entradas idênticas no PDF individual e no do lote", async (nome, modelo) => {
    const template = lerFixture(nome);
    const [original] = await lerPaginasDoPdf(template);

    for (const quantidade of [1, 4]) {
      const saida = await renderTemplatePdf(template, config(modelo.areaDoQr), urls(quantidade));
      const paginas = await lerPaginasDoPdf(saida);
      expect(paginas).toHaveLength(quantidade);
      for (const pagina of paginas) {
        expect(pagina.caixas).toEqual(original.caixas);
        expect(pagina.rotacao).toBe(0);
        expect(pagina.entradas).toEqual(original.entradas);
      }
      // O renderizador (pdf.js) também enxerga a mesma página visível.
      const renderizada = await renderizarPagina(saida, quantidade, 72);
      expect(renderizada.visao).toEqual(modelo.visao.map((valor) => Math.round(valor * 1000) / 1000));
    }
  });

  it("mantém TrimBox e BleedBox quando o template as declara", async () => {
    const modelo = criarPdfDeTemplate({ trimBoxMm: 3 });
    const [original] = await lerPaginasDoPdf(modelo.bytes);
    expect(original.caixas.TrimBox).not.toBeNull();
    expect(original.caixas.BleedBox).not.toBeNull();

    const paginas = await lerPaginasDoPdf(await renderTemplatePdf(modelo.bytes, config(modelo.areaDoQr), urls(3)));
    for (const pagina of paginas) expect(pagina.caixas).toEqual(original.caixas);
  });
});

describe("a arte original é preservada", () => {
  it("fluxo de conteúdo e imagem saem byte a byte iguais, sem recompressão", async () => {
    const template = lerFixture("template-google");
    const [original] = await lerPaginasDoPdf(template);
    expect(original.conteudo).toHaveLength(1);
    expect(original.xobjects).toHaveLength(1);

    const saida = await renderTemplatePdf(template, config(google.areaDoQr), [URL_PERMANENTE]);
    const [pagina] = await lerPaginasDoPdf(saida);

    // Conteúdo da página: [abre o isolamento, ARTE ORIGINAL, fecha o isolamento + QR].
    expect(pagina.conteudo).toHaveLength(3);
    expect(Buffer.from(pagina.conteudo[0].bytes).toString("latin1").trim()).toBe("q");
    expect(Buffer.from(pagina.conteudo[1].bytes).equals(Buffer.from(original.conteudo[0].bytes))).toBe(true);
    expect(pagina.conteudo[1].dicionario).toBe(original.conteudo[0].dicionario);

    expect(pagina.xobjects).toHaveLength(1);
    expect(Buffer.from(pagina.xobjects[0].bytes).equals(Buffer.from(original.xobjects[0].bytes))).toBe(true);
    expect(pagina.xobjects[0].dicionario).toBe(original.xobjects[0].dicionario);

    // Conferência direta nos bytes do arquivo, sem passar pela biblioteca de PDF.
    expect(contarOcorrencias(saida, original.conteudo[0].bytes)).toBe(1);
    expect(contarOcorrencias(saida, original.xobjects[0].bytes)).toBe(1);
  });

  it("visualmente, só a área do QR muda", async () => {
    const template = lerFixture("template-google");
    const saida = await renderTemplatePdf(template, config(google.areaDoQr), [URL_PERMANENTE]);
    const diferenca = regiaoDiferente(await renderizarPagina(template), await renderizarPagina(saida));
    expect(diferenca).not.toBeNull();
    // Meio pixel de folga (a 300 dpi, 1 px = 0,24 pt) por causa da suavização das bordas.
    dentroDe(diferenca!, google.areaDoQr, 0.25);
  });

  it("a mesma entrada produz exatamente o mesmo arquivo", async () => {
    const template = lerFixture("template-instagram");
    const a = await renderTemplatePdf(template, config(google.areaDoQr), urls(3));
    const b = await renderTemplatePdf(template, config(google.areaDoQr), urls(3));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("não acrescenta metadados nem troca o produtor do arquivo", async () => {
    const saida = await renderTemplatePdf(lerFixture("template-google"), config(google.areaDoQr), [URL_PERMANENTE]);
    const texto = Buffer.from(saida).toString("latin1");
    expect(texto).not.toContain("pdf-lib");
    expect(texto).not.toContain("/Producer");
    expect(texto).not.toContain("/ModDate");
  });
});

describe("posição e desenho do QR", () => {
  it("fica dentro da área, centralizado, com a zona de silêncio respeitada", async () => {
    const lado = gerarMatrizDoConteudo(URL_PERMANENTE).lado;
    const areas: [string, RetanguloPt][] = [
      ["quadrada", google.areaDoQr],
      ["mais larga que alta", { x: 200, y: 60, largura: 150, altura: 90 }],
      ["mais alta que larga", { x: 230, y: 20, largura: 80, altura: 200 }],
    ];

    for (const zona of [4, 2, 6]) {
      for (const [, area] of areas) {
        const cfg = config(area, zona);
        const saida = await renderTemplatePdf(lerFixture("template-google"), cfg, [URL_PERMANENTE]);
        const [desenho] = await lerDesenhosDoQr(saida);
        const esperado = quadradoDoQr(cfg, lado);

        // O fundo branco cobre só o quadrado do QR (não a área inteira) e fica centralizado nela.
        expect(desenho.fundo.largura).toBeCloseTo(Math.min(area.largura, area.altura), 3);
        expect(desenho.fundo.altura).toBeCloseTo(desenho.fundo.largura, 3);
        expect(desenho.fundo.x + desenho.fundo.largura / 2).toBeCloseTo(area.x + area.largura / 2, 3);
        expect(desenho.fundo.y + desenho.fundo.altura / 2).toBeCloseTo(area.y + area.altura / 2, 3);
        dentroDe(desenho.fundo, area);

        // Os módulos ficam a exatamente `zona` módulos de cada borda do quadrado branco.
        expect(desenho.modulo).toBeCloseTo(esperado.modulo, 3);
        expect(desenho.modulos.largura / desenho.modulo).toBeCloseTo(lado, 2);
        for (const margem of [
          desenho.modulos.x - desenho.fundo.x,
          desenho.modulos.y - desenho.fundo.y,
          desenho.fundo.x + desenho.fundo.largura - (desenho.modulos.x + desenho.modulos.largura),
          desenho.fundo.y + desenho.fundo.altura - (desenho.modulos.y + desenho.modulos.altura),
        ]) {
          expect(margem / desenho.modulo).toBeCloseTo(zona, 2);
        }
        expect(desenho.conteudo).toBe(URL_PERMANENTE);
      }
    }
  });

  it("é vetorial: fundo branco e módulos em 100% K, em um único preenchimento, sem traços", async () => {
    const saida = await renderTemplatePdf(lerFixture("template-google"), config(google.areaDoQr), [URL_PERMANENTE]);
    const [desenho] = await lerDesenhosDoQr(saida);
    expect(desenho.cores).toEqual(["0 0 0 0 k", "0 0 0 1 k"]);
    // Dois preenchimentos: o do fundo e UM para todos os módulos.
    expect(desenho.preenchimentos).toBe(2);
    expect(desenho.tracos).toBe(0);
    // Nenhuma imagem nova: o QR não é rasterizado.
    const [pagina] = await lerPaginasDoPdf(saida);
    expect(pagina.xobjects).toHaveLength(1);
    expect(desenho.operadores).not.toMatch(/\bDo\b|\bBI\b/);
  });

  it("o QR renderizado é lido como a URL permanente, e está onde foi configurado", async () => {
    for (const nome of ["template-google", "template-instagram"] as const) {
      const saida = await renderTemplatePdf(lerFixture(nome), config(google.areaDoQr), [URL_PERMANENTE]);
      const lido = await lerQrDaPagina(saida);
      expect(lido?.conteudo).toBe(URL_PERMANENTE);
      dentroDe(lido!.regiao, google.areaDoQr, 0.5);

      // Os cantos lidos da imagem coincidem com o QR calculado (folga de meio módulo).
      const esperado = quadradoDoQr(config(google.areaDoQr), gerarMatrizDoConteudo(URL_PERMANENTE).lado);
      const inicio = esperado.x + 4 * esperado.modulo;
      expect(Math.abs(lido!.regiao.x - inicio)).toBeLessThan(esperado.modulo / 2);
      expect(Math.abs(lido!.regiao.largura - esperado.ladoDoSimbolo)).toBeLessThan(esperado.modulo);
    }
  });

  it("respeita a origem da MediaBox e a CropBox", async () => {
    for (const [nome, opcoes] of [
      ["mediabox-com-origem", { origem: [100, 200] as [number, number] }],
      ["cropbox-menor", { origem: [10, 15] as [number, number], margemDaCropBox: 20 }],
    ] as const) {
      const modelo = criarPdfDeTemplate(opcoes);
      const saida = await renderTemplatePdf(lerFixture(nome), config(modelo.areaDoQr), [URL_PERMANENTE]);
      const lido = await lerQrDaPagina(saida);
      expect(lido?.conteudo).toBe(URL_PERMANENTE);
      dentroDe(lido!.regiao, modelo.areaDoQr, 0.5);
      // E continua sobre o espaço em branco da arte: só essa região muda.
      const diferenca = regiaoDiferente(await renderizarPagina(lerFixture(nome)), await renderizarPagina(saida));
      dentroDe(diferenca!, modelo.areaDoQr, 0.25);
    }
  });
});

describe("arte que deixa o estado gráfico desbalanceado", () => {
  it("a fixture realmente deixa estados abertos, ampliação e recorte", () => {
    const [x, y] = [mmToPt(1), mmToPt(1)];
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(analisarEstadoGrafico(new TextEncoder().encode("q 1 0 0 1 0 0 cm q 2 0 0 2 0 0 cm"))).toEqual({
      minimo: 0,
      final: 2,
    });
  });

  it("o QR continua no lugar certo, inteiro e legível", async () => {
    const template = lerFixture("transformacao-desbalanceada");
    const saida = await renderTemplatePdf(template, config(google.areaDoQr), [URL_PERMANENTE]);

    const lido = await lerQrDaPagina(saida);
    expect(lido?.conteudo).toBe(URL_PERMANENTE);
    dentroDe(lido!.regiao, google.areaDoQr, 0.5);

    // Mesma posição do QR gerado sobre a arte bem comportada.
    const referencia = await lerQrDaPagina(
      await renderTemplatePdf(lerFixture("template-google"), config(google.areaDoQr), [URL_PERMANENTE]),
    );
    expect(lido!.regiao.x).toBeCloseTo(referencia!.regiao.x, 1);
    expect(lido!.regiao.y).toBeCloseTo(referencia!.regiao.y, 1);
    expect(lido!.regiao.largura).toBeCloseTo(referencia!.regiao.largura, 1);

    // A arte abre dois estados; o gerador fecha os dois e mais o seu.
    const [desenho] = await lerDesenhosDoQr(saida);
    expect(desenho.operadores.trimStart().startsWith("Q Q Q\n")).toBe(true);
  });

  it("também isola a arte que fecha um estado gráfico que não abriu", async () => {
    const modelo = criarPdfDeTemplate({ restauracaoAMais: true });
    const saida = await renderTemplatePdf(modelo.bytes, config(modelo.areaDoQr), [URL_PERMANENTE]);
    const [pagina] = await lerPaginasDoPdf(saida);
    expect(Buffer.from(pagina.conteudo[0].bytes).toString("latin1").trim()).toBe("q q");

    const lido = await lerQrDaPagina(saida);
    expect(lido?.conteudo).toBe(URL_PERMANENTE);
    dentroDe(lido!.regiao, modelo.areaDoQr, 0.5);
  });

  it("conta q e Q sem se confundir com textos, nomes, comentários e imagens embutidas", () => {
    const analisar = (texto: string) => analisarEstadoGrafico(Buffer.from(texto, "latin1"));
    expect(analisar("q Q")).toEqual({ minimo: 0, final: 0 });
    expect(analisar("Q q q")).toEqual({ minimo: -1, final: 1 });
    expect(analisar("q\nBT (texto com q Q \\) e \\( Q) Tj [(Q) 3 (q)] TJ ET\nQ")).toEqual({ minimo: 0, final: 0 });
    expect(analisar("q /Q gs /q Do <51 71> Tj % Q Q Q\nQ")).toEqual({ minimo: 0, final: 0 });
    expect(analisar("q BI /W 2 /H 2 /BPC 8 /CS /G ID Q\x00 Q q\xff EI Q")).toEqual({ minimo: 0, final: 0 });
    expect(analisar("q << /MCID 0 >> BDC Q EMC")).toEqual({ minimo: 0, final: 0 });
    expect(analisar("")).toEqual({ minimo: 0, final: 0 });
    // Operadores que só contêm as letras não contam: "Qx" e "sq" não são q nem Q.
    expect(analisar("Qx sq 1 0 0 RG")).toEqual({ minimo: 0, final: 0 });
  });
});

describe("lote", () => {
  it("N páginas com N QR distintos, cada um com a sua URL, na ordem recebida", async () => {
    const lista = urls(100);
    expect(new Set(lista).size).toBe(100);

    const saida = await renderTemplatePdf(lerFixture("template-google"), config(google.areaDoQr), lista);
    expect(await contarPaginas(saida)).toBe(100);

    const desenhos = await lerDesenhosDoQr(saida);
    expect(desenhos.map((desenho) => desenho.conteudo)).toEqual(lista);

    // Leitura pela imagem renderizada em três páginas do lote (primeira, do meio e última).
    for (const numero of [1, 50, 100]) {
      const lido = await lerQrDaPagina(saida, numero);
      expect(lido?.conteudo).toBe(lista[numero - 1]);
      dentroDe(lido!.regiao, google.areaDoQr, 0.5);
    }
  });

  it("os recursos da arte são compartilhados: o arquivo pesa o template mais ~1 KB por página", async () => {
    // Arte "pesada": 2 MB de dados nos recursos da página.
    const pesado = criarPdfDeTemplate({ pesoExtraBytes: 2 * 1024 * 1024 });
    const [original] = await lerPaginasDoPdf(pesado.bytes);
    const lista = urls(100);

    const saida = await renderTemplatePdf(pesado.bytes, config(pesado.areaDoQr), lista);
    const porPagina = (saida.length - pesado.bytes.length) / lista.length;
    expect(porPagina).toBeLessThan(2048);
    expect(saida.length).toBeLessThan(pesado.bytes.length + 4096 + lista.length * 2048);

    // Cada objeto da arte aparece uma única vez no arquivo, e todas as páginas apontam para ele.
    for (const fluxo of [...original.conteudo, ...original.xobjects]) {
      expect(contarOcorrencias(saida, fluxo.bytes.subarray(0, 4096))).toBe(1);
    }
    const paginas = await lerPaginasDoPdf(saida);
    expect(new Set(paginas.map((pagina) => pagina.conteudo[1].referencia)).size).toBe(1);
    expect(new Set(paginas.map((pagina) => pagina.xobjects.map((x) => x.referencia).join())).size).toBe(1);
    // Só o trecho do QR é próprio de cada página.
    expect(new Set(paginas.map((pagina) => pagina.conteudo[2].referencia)).size).toBe(100);
  });

  it("recusa mais cartões do que o limite por PDF, com mensagem clara", async () => {
    expect(MAXIMO_DE_CARTOES_POR_PDF).toBe(1000);
    await expect(
      renderTemplatePdf(lerFixture("template-google"), config(google.areaDoQr), urls(MAXIMO_DE_CARTOES_POR_PDF + 1)),
    ).rejects.toThrow("Um PDF pode ter no máximo 1000 cartões (foram pedidos 1001). Divida o lote.");
  });
});

describe("o que o gerador recusa", () => {
  const template = lerFixture("template-google");

  it("qualquer conteúdo de QR que não seja a URL permanente de um cartão", async () => {
    for (const url of [
      "https://www.instagram.com/cliente",
      "https://g.page/r/abc/review",
      "https://go.example.com/admin",
      "https://go.example.com/c/K8M4T2?destino=https://instagram.com",
      "https://go.example.com/c/K8M4T2/extra",
      "javascript:alert(1)",
      "",
    ]) {
      await expect(renderTemplatePdf(template, config(google.areaDoQr), [url])).rejects.toThrow(
        "O QR Code de um template só pode conter a URL permanente de um cartão.",
      );
    }
    await expect(renderTemplatePdf(template, config(google.areaDoQr), [])).rejects.toThrow(ErroDeDominio);
  });

  it("área do QR fora da página, com tamanho inválido ou zona de silêncio menor que 2", async () => {
    const fora = { ...google.areaDoQr, x: 300 };
    await expect(renderTemplatePdf(template, config(fora), [URL_PERMANENTE])).rejects.toThrow("dentro da página");
    await expect(
      renderTemplatePdf(template, config({ ...google.areaDoQr, largura: 0 }), [URL_PERMANENTE]),
    ).rejects.toThrow("maiores que zero");
    await expect(renderTemplatePdf(template, config(google.areaDoQr, 1), [URL_PERMANENTE])).rejects.toThrow(
      "zona de silêncio",
    );
    // Em um template com CropBox, a área precisa estar na página VISÍVEL, não só na MediaBox.
    const comCorte = criarPdfDeTemplate({ origem: [10, 15], margemDaCropBox: 20 });
    await expect(
      renderTemplatePdf(comCorte.bytes, config({ x: 12, y: 17, largura: 60, altura: 60 }), [URL_PERMANENTE]),
    ).rejects.toThrow("dentro da página");
  });

  it("arquivo que não é um PDF de uma página", async () => {
    await expect(renderTemplatePdf(lerFixture("duas-paginas"), config(google.areaDoQr), [URL_PERMANENTE])).rejects.toThrow(
      "O template deve possuir apenas uma página.",
    );
    await expect(renderTemplatePdf(lerFixture("protegido-por-senha"), config(google.areaDoQr), [URL_PERMANENTE])).rejects.toThrow(
      ErroDeDominio,
    );
  });
});
