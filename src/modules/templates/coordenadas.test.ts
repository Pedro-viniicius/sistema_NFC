import { describe, expect, it } from "vitest";
import {
  LADO_MINIMO_DA_AREA_DO_QR_MM,
  areaAPartirDeMm,
  areaParaMm,
  caixaVisivel,
  limitarAreaAPagina,
  mmToPt,
  pdfToPreviewCoordinates,
  previewToPdfCoordinates,
  ptToMm,
  validateQrArea,
  type PreviaDaPagina,
  type RetanguloNaPrevia,
} from "./coordenadas";
import { formatarDimensoesMm, formatarMm, lerNumero, slugDoNome } from "./formato";
import { MODULO_PEQUENO_MM, QR_PEQUENO_MM, medidasDoQr, quadradoDoQr } from "./geometria-do-qr";
import type { CaixaPt, RetanguloPt } from "./tipos";

/** px de CSS por ponto com zoom de 100%: 96 px por polegada / 72 pt por polegada. */
const CSS_POR_PONTO = 96 / 72;
/** Erro máximo aceito nas conversões: 0,01 mm. */
const TOLERANCIA_MM = 0.01;

const PAGINA: CaixaPt = [0, 0, mmToPt(130.05), mmToPt(86.7)];
const previa = (visao: CaixaPt, zoom: number): PreviaDaPagina => ({
  visao,
  larguraCss: (visao[2] - visao[0]) * CSS_POR_PONTO * zoom,
});

function esperarIguais(a: RetanguloPt, b: RetanguloPt): void {
  for (const campo of ["x", "y", "largura", "altura"] as const) {
    expect(Math.abs(ptToMm(a[campo] - b[campo]))).toBeLessThanOrEqual(TOLERANCIA_MM);
  }
}

describe("mm ↔ pontos", () => {
  it("1 pt = 25,4/72 mm", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
    expect(ptToMm(72)).toBeCloseTo(25.4, 10);
    expect(ptToMm(1)).toBeCloseTo(25.4 / 72, 12);
    expect(mmToPt(130.05)).toBeCloseTo(368.646, 3);
  });

  it("ida e volta sem perda", () => {
    for (const mm of [0, 0.01, 0.4, 15, 34, 82.5, 86.7, 130.05, 1999.99]) {
      expect(ptToMm(mmToPt(mm))).toBeCloseTo(mm, 9);
      expect(mmToPt(ptToMm(mmToPt(mm)))).toBeCloseTo(mmToPt(mm), 9);
    }
  });
});

describe("prévia ↔ PDF", () => {
  it("inverte o eixo vertical: o topo da prévia é o alto da página no PDF", () => {
    const p = previa(PAGINA, 1);
    const alturaCss = (PAGINA[3] - PAGINA[1]) * CSS_POR_PONTO;

    // Retângulo de 100 × 50 px encostado no canto SUPERIOR esquerdo da prévia.
    const noTopo = previewToPdfCoordinates({ esquerda: 0, topo: 0, largura: 100, altura: 50 }, p);
    expect(noTopo.x).toBeCloseTo(0, 9);
    expect(noTopo.y).toBeCloseTo(PAGINA[3] - 50 / CSS_POR_PONTO, 9);
    expect(noTopo.largura).toBeCloseTo(75, 9);
    expect(noTopo.altura).toBeCloseTo(37.5, 9);

    // O mesmo retângulo encostado no canto INFERIOR esquerdo: y = 0 no PDF.
    const naBase = previewToPdfCoordinates({ esquerda: 0, topo: alturaCss - 50, largura: 100, altura: 50 }, p);
    expect(naBase.y).toBeCloseTo(0, 9);
  });

  it("a conversão de volta é a inversa exata", () => {
    const p = previa(PAGINA, 1.5);
    const naTela: RetanguloNaPrevia = { esquerda: 123.4, topo: 56.7, largura: 180.25, altura: 181.5 };
    const devolvido = pdfToPreviewCoordinates(previewToPdfCoordinates(naTela, p), p);
    expect(devolvido.esquerda).toBeCloseTo(naTela.esquerda, 9);
    expect(devolvido.topo).toBeCloseTo(naTela.topo, 9);
    expect(devolvido.largura).toBeCloseTo(naTela.largura, 9);
    expect(devolvido.altura).toBeCloseTo(naTela.altura, 9);
  });

  it("usa a origem real da caixa quando ela não é (0, 0)", () => {
    const visao: CaixaPt = [100, 200, 100 + mmToPt(130.05), 200 + mmToPt(86.7)];
    const p = previa(visao, 1);
    const noCanto = previewToPdfCoordinates({ esquerda: 0, topo: 0, largura: 40, altura: 40 }, p);
    expect(noCanto.x).toBeCloseTo(100, 9);
    expect(noCanto.y).toBeCloseTo(visao[3] - 30, 9);

    const area: RetanguloPt = { x: 328.2, y: 291.6, largura: 96.4, altura: 96.4 };
    esperarIguais(previewToPdfCoordinates(pdfToPreviewCoordinates(area, p), p), area);
    // O canto superior esquerdo do retângulo na tela é medido a partir da página visível.
    const naTela = pdfToPreviewCoordinates(area, p);
    expect(naTela.esquerda).toBeCloseTo((328.2 - 100) * CSS_POR_PONTO, 9);
    expect(naTela.topo).toBeCloseTo((visao[3] - (291.6 + 96.4)) * CSS_POR_PONTO, 9);
  });

  it("com CropBox diferente da MediaBox, a referência é a página visível (como no pdf.js)", () => {
    const mediaBox: CaixaPt = [10, 15, 418.646, 300.764];
    const cropBox: CaixaPt = [30, 35, 398.646, 280.764];
    const visao = caixaVisivel(mediaBox, cropBox);
    expect(visao).toEqual(cropBox);

    const p = previa(visao, 1);
    const noCanto = previewToPdfCoordinates({ esquerda: 0, topo: 0, largura: 10, altura: 10 }, p);
    expect(noCanto.x).toBeCloseTo(30, 9);
    expect(noCanto.y + noCanto.altura).toBeCloseTo(280.764, 9);
  });

  it("a página visível é a CropBox limitada à MediaBox; interseção vazia vale a MediaBox", () => {
    const mediaBox: CaixaPt = [0, 0, 300, 200];
    expect(caixaVisivel(mediaBox, mediaBox)).toEqual(mediaBox);
    expect(caixaVisivel(mediaBox, [-50, -50, 150, 400])).toEqual([0, 0, 150, 200]);
    expect(caixaVisivel(mediaBox, [400, 400, 500, 500])).toEqual(mediaBox);
  });

  it("o mesmo retângulo visual em 50%, 100% e 150% de zoom dá os mesmos pontos", () => {
    const area: RetanguloPt = { x: 228.19, y: 87.02, largura: 96.378, altura: 96.378 };
    for (const visao of [PAGINA, [100, 200, 468.646, 445.764] as CaixaPt]) {
      const base = { ...area, x: area.x + visao[0], y: area.y + visao[1] };
      const resultados = [0.5, 1, 1.5, 0.731].map((zoom) => {
        const p = previa(visao, zoom);
        // O que o administrador vê e arrasta na tela, nesse zoom...
        const naTela = pdfToPreviewCoordinates(base, p);
        // ...com a tela arredondando para centésimos de px, como um navegador faria.
        const arredondado: RetanguloNaPrevia = {
          esquerda: Math.round(naTela.esquerda * 100) / 100,
          topo: Math.round(naTela.topo * 100) / 100,
          largura: Math.round(naTela.largura * 100) / 100,
          altura: Math.round(naTela.altura * 100) / 100,
        };
        return previewToPdfCoordinates(arredondado, p);
      });
      for (const resultado of resultados) esperarIguais(resultado, base);
    }
  });

  it("não depende do devicePixelRatio: só a largura em px de CSS entra na conta", () => {
    const p = previa(PAGINA, 1);
    const naTela: RetanguloNaPrevia = { esquerda: 300, topo: 80, largura: 128, altura: 128 };
    // Um canvas de alta densidade tem mais pixels, mas a largura em CSS é a mesma.
    expect(previewToPdfCoordinates(naTela, { ...p })).toEqual(previewToPdfCoordinates(naTela, p));
    expect(() => previewToPdfCoordinates(naTela, { visao: PAGINA, larguraCss: 0 })).toThrow(RangeError);
  });

  it("converte para mm a partir do canto superior esquerdo e volta", () => {
    const visao: CaixaPt = [100, 200, 100 + mmToPt(130.05), 200 + mmToPt(86.7)];
    const area = areaAPartirDeMm({ xMm: 80.5, yMm: 22, larguraMm: 34, alturaMm: 34 }, visao);
    expect(area.x).toBeCloseTo(100 + mmToPt(80.5), 9);
    // 22 mm do topo e 34 mm de altura: a base fica a 86,70 − 56 = 30,70 mm da base da página.
    expect(area.y).toBeCloseTo(200 + mmToPt(30.7), 9);

    const emMm = areaParaMm(area, visao);
    expect(emMm.xMm).toBeCloseTo(80.5, 9);
    expect(emMm.yMm).toBeCloseTo(22, 9);
    expect(emMm.larguraMm).toBeCloseTo(34, 9);
    expect(emMm.alturaMm).toBeCloseTo(34, 9);
  });
});

describe("validação da área do QR", () => {
  const valida: RetanguloPt = { x: 228, y: 87, largura: 96, altura: 96 };

  it("aceita uma área dentro da página, inclusive encostada nas bordas", () => {
    expect(validateQrArea(valida, PAGINA)).toEqual([]);
    expect(validateQrArea({ x: 0, y: 0, largura: PAGINA[2], altura: PAGINA[3] }, PAGINA)).toEqual([]);
  });

  it("recusa área fora da página, em qualquer lado", () => {
    const fora = "A área do QR Code deve ficar inteira dentro da página.";
    expect(validateQrArea({ ...valida, x: -1 }, PAGINA)).toEqual([fora]);
    expect(validateQrArea({ ...valida, y: -1 }, PAGINA)).toEqual([fora]);
    expect(validateQrArea({ ...valida, x: PAGINA[2] - 50 }, PAGINA)).toEqual([fora]);
    expect(validateQrArea({ ...valida, y: PAGINA[3] - 50 }, PAGINA)).toEqual([fora]);
    // Com origem deslocada, o que valia em (0, 0) fica fora.
    expect(validateQrArea(valida, [300, 300, 700, 600])).toEqual([fora]);
  });

  it("recusa tamanho zero, negativo, não numérico e abaixo do mínimo", () => {
    const positivo = "A área do QR Code deve ter largura e altura maiores que zero.";
    expect(validateQrArea({ ...valida, largura: 0 }, PAGINA)).toEqual([positivo]);
    expect(validateQrArea({ ...valida, altura: -10 }, PAGINA)).toEqual([positivo]);
    expect(validateQrArea({ ...valida, x: Number.NaN }, PAGINA)).toEqual(["A área do QR Code tem medidas inválidas."]);
    expect(validateQrArea({ ...valida, largura: Number.POSITIVE_INFINITY }, PAGINA)).toHaveLength(1);

    const pequena = mmToPt(LADO_MINIMO_DA_AREA_DO_QR_MM - 0.5);
    expect(validateQrArea({ ...valida, largura: pequena, altura: pequena }, PAGINA)).toEqual([
      "A área do QR Code deve ter pelo menos 10 × 10 mm.",
    ]);
    const noMinimo = mmToPt(LADO_MINIMO_DA_AREA_DO_QR_MM);
    expect(validateQrArea({ ...valida, largura: noMinimo, altura: noMinimo }, PAGINA)).toEqual([]);
  });

  it("limitarAreaAPagina traz a área de volta para dentro", () => {
    const ajustada = limitarAreaAPagina({ x: -20, y: PAGINA[3], largura: 96, altura: 96 }, PAGINA);
    expect(validateQrArea(ajustada, PAGINA)).toEqual([]);
    expect(ajustada).toEqual({ x: 0, y: PAGINA[3] - 96, largura: 96, altura: 96 });
  });
});

describe("geometria do QR na área", () => {
  it("é o maior quadrado que cabe, centralizado, com a zona de silêncio por dentro", () => {
    const area: RetanguloPt = { x: 200, y: 50, largura: 120, altura: 90 };
    const quadrado = quadradoDoQr({ area, zonaDeSilencioModulos: 4 }, 37);
    expect(quadrado.lado).toBe(90);
    expect(quadrado.x).toBe(215);
    expect(quadrado.y).toBe(50);
    expect(quadrado.modulo).toBeCloseTo(90 / 45, 12);
    expect(quadrado.ladoDoSimbolo).toBeCloseTo(37 * 2, 12);

    const emPe = quadradoDoQr({ area: { x: 10, y: 10, largura: 60, altura: 100 }, zonaDeSilencioModulos: 2 }, 33);
    expect(emPe.lado).toBe(60);
    expect(emPe.x).toBe(10);
    expect(emPe.y).toBe(30);
    expect(emPe.modulo).toBeCloseTo(60 / 37, 12);
  });

  it("avisa (sem bloquear) quando o QR ou o módulo ficam pequenos", () => {
    expect(QR_PEQUENO_MM).toBe(15);
    expect(MODULO_PEQUENO_MM).toBe(0.4);

    const lado = (mm: number): RetanguloPt => ({ x: 0, y: 0, largura: mmToPt(mm), altura: mmToPt(mm) });
    const bom = medidasDoQr({ area: lado(34), zonaDeSilencioModulos: 4 }, 37);
    expect(bom.avisos).toEqual([]);
    expect(bom.ladoComMargemMm).toBeCloseTo(34, 9);
    expect(bom.moduloMm).toBeCloseTo(34 / 45, 9);
    expect(bom.ladoMm).toBeCloseTo((34 / 45) * 37, 9);

    const pequeno = medidasDoQr({ area: lado(16), zonaDeSilencioModulos: 4 }, 37);
    expect(pequeno.avisos).toHaveLength(2);
    expect(pequeno.avisos[0]).toContain("menos de 15 mm");
    expect(pequeno.avisos[1]).toContain("menos de 0,4 mm");
  });
});

describe("números no padrão brasileiro", () => {
  it("formata com vírgula decimal", () => {
    expect(formatarMm(130.05)).toBe("130,05");
    expect(formatarMm(86.7)).toBe("86,70");
    expect(formatarMm(0.756, 2)).toBe("0,76");
    expect(formatarDimensoesMm(130.05, 86.7)).toBe("130,05 × 86,70 mm");
  });

  it("lê números com vírgula ou ponto", () => {
    expect(lerNumero("82,5")).toBe(82.5);
    expect(lerNumero("82.5")).toBe(82.5);
    expect(lerNumero(" 34 ")).toBe(34);
    expect(lerNumero("0,4")).toBe(0.4);
    for (const invalido of ["", "abc", "1,2,3", "1.000,50", "12mm", "Infinity", null, undefined]) {
      expect(lerNumero(invalido)).toBeNull();
    }
  });

  it("gera um trecho seguro para nomes de arquivo", () => {
    expect(slugDoNome("Google — Modelo 01")).toBe("google-modelo-01");
    expect(slugDoNome("Açaí & Cia. (versão 2)")).toBe("acai-cia-versao-2");
    expect(slugDoNome("../../etc")).toBe("etc");
    expect(slugDoNome("—")).toBe("template");
  });
});
