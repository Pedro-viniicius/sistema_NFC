// Coordenadas dos templates de impressão. Funções puras, usadas no servidor e no editor do painel.
//
// FONTE DE VERDADE: pontos do PDF no espaço do usuário da página.
//   - PDF: origem no canto INFERIOR esquerdo, unidade = ponto (1 pt = 25,4/72 mm). As caixas da
//     página podem não começar em (0, 0): use sempre os valores reais da caixa.
//   - Prévia (pdf.js): origem no canto SUPERIOR esquerdo, unidade = px de CSS. O pdf.js desenha
//     `page.view`, que é a CropBox limitada à MediaBox — aqui chamada de "página visível".
//
// Só pontos são gravados no banco. Pixels, zoom e devicePixelRatio existem apenas na tela.
import { mmParaPontos, pontosParaMm } from "@/modules/printing/unidades";
import type { CaixaPt, RetanguloPt } from "./tipos";

export const mmToPt = mmParaPontos;
export const ptToMm = pontosParaMm;

/** Menor lado aceito para a área do QR. Abaixo disso não há QR legível em impressão. */
export const LADO_MINIMO_DA_AREA_DO_QR_MM = 10;

/** Folga para comparações de borda, em pontos (≈ 0,0004 mm): absorve erros de ponto flutuante. */
const TOLERANCIA_PT = 0.001;

/**
 * Página visível: a CropBox limitada à MediaBox, exatamente como o `page.view` do pdf.js.
 * Se a interseção for vazia, vale a MediaBox (mesma regra do pdf.js).
 */
export function caixaVisivel(mediaBox: CaixaPt, cropBox: CaixaPt): CaixaPt {
  const visivel: CaixaPt = [
    Math.max(mediaBox[0], cropBox[0]),
    Math.max(mediaBox[1], cropBox[1]),
    Math.min(mediaBox[2], cropBox[2]),
    Math.min(mediaBox[3], cropBox[3]),
  ];
  return visivel[2] - visivel[0] > 0 && visivel[3] - visivel[1] > 0 ? visivel : mediaBox;
}

export function larguraDaCaixa(caixa: CaixaPt): number {
  return caixa[2] - caixa[0];
}

export function alturaDaCaixa(caixa: CaixaPt): number {
  return caixa[3] - caixa[1];
}

/** Retângulo na prévia: px de CSS a partir do canto superior esquerdo da página visível. */
export interface RetanguloNaPrevia {
  esquerda: number;
  topo: number;
  largura: number;
  altura: number;
}

export interface PreviaDaPagina {
  /** `page.view` do pdf.js: [vx0, vy0, vx1, vy1] em pontos. */
  visao: CaixaPt;
  /** Largura com que a página é exibida, em px de CSS (não em pixels do canvas). */
  larguraCss: number;
}

/** px de CSS por ponto. */
function escala(previa: PreviaDaPagina): number {
  const s = previa.larguraCss / larguraDaCaixa(previa.visao);
  if (!Number.isFinite(s) || s <= 0) throw new RangeError("Prévia com dimensões inválidas.");
  return s;
}

/** Prévia (px de CSS, origem em cima) → PDF (pontos, origem embaixo). */
export function previewToPdfCoordinates(retangulo: RetanguloNaPrevia, previa: PreviaDaPagina): RetanguloPt {
  const s = escala(previa);
  const [vx0, , , vy1] = previa.visao;
  return {
    x: vx0 + retangulo.esquerda / s,
    // A borda INFERIOR do retângulo, medida a partir da base da página.
    y: vy1 - (retangulo.topo + retangulo.altura) / s,
    largura: retangulo.largura / s,
    altura: retangulo.altura / s,
  };
}

/** PDF (pontos, origem embaixo) → prévia (px de CSS, origem em cima). Inversa exata da anterior. */
export function pdfToPreviewCoordinates(retangulo: RetanguloPt, previa: PreviaDaPagina): RetanguloNaPrevia {
  const s = escala(previa);
  const [vx0, , , vy1] = previa.visao;
  return {
    esquerda: (retangulo.x - vx0) * s,
    topo: (vy1 - (retangulo.y + retangulo.altura)) * s,
    largura: retangulo.largura * s,
    altura: retangulo.altura * s,
  };
}

/** Área em mm, medida a partir do canto superior esquerdo da página visível (como o administrador vê). */
export interface AreaEmMm {
  xMm: number;
  yMm: number;
  larguraMm: number;
  alturaMm: number;
}

export function areaParaMm(area: RetanguloPt, visao: CaixaPt): AreaEmMm {
  return {
    xMm: ptToMm(area.x - visao[0]),
    yMm: ptToMm(visao[3] - (area.y + area.altura)),
    larguraMm: ptToMm(area.largura),
    alturaMm: ptToMm(area.altura),
  };
}

export function areaAPartirDeMm(area: AreaEmMm, visao: CaixaPt): RetanguloPt {
  const altura = mmToPt(area.alturaMm);
  return {
    x: visao[0] + mmToPt(area.xMm),
    y: visao[3] - mmToPt(area.yMm) - altura,
    largura: mmToPt(area.larguraMm),
    altura,
  };
}

/**
 * Confere a área do QR: números válidos, tamanho positivo e não menor que o mínimo, e inteira
 * dentro da página visível. Devolve a lista de problemas (vazia = área válida).
 */
export function validateQrArea(area: RetanguloPt, visao: CaixaPt): string[] {
  const { x, y, largura, altura } = area;
  if (![x, y, largura, altura].every(Number.isFinite)) {
    return ["A área do QR Code tem medidas inválidas."];
  }
  if (largura <= 0 || altura <= 0) {
    return ["A área do QR Code deve ter largura e altura maiores que zero."];
  }

  const problemas: string[] = [];
  const minimo = mmToPt(LADO_MINIMO_DA_AREA_DO_QR_MM);
  if (largura < minimo - TOLERANCIA_PT || altura < minimo - TOLERANCIA_PT) {
    problemas.push(`A área do QR Code deve ter pelo menos ${LADO_MINIMO_DA_AREA_DO_QR_MM} × ${LADO_MINIMO_DA_AREA_DO_QR_MM} mm.`);
  }
  const dentro =
    x >= visao[0] - TOLERANCIA_PT &&
    y >= visao[1] - TOLERANCIA_PT &&
    x + largura <= visao[2] + TOLERANCIA_PT &&
    y + altura <= visao[3] + TOLERANCIA_PT;
  if (!dentro) {
    problemas.push("A área do QR Code deve ficar inteira dentro da página.");
  }
  return problemas;
}

/** Ajusta a área para dentro da página visível, mantendo o tamanho quando possível. */
export function limitarAreaAPagina(area: RetanguloPt, visao: CaixaPt): RetanguloPt {
  const largura = Math.min(area.largura, larguraDaCaixa(visao));
  const altura = Math.min(area.altura, alturaDaCaixa(visao));
  return {
    x: Math.min(Math.max(area.x, visao[0]), visao[2] - largura),
    y: Math.min(Math.max(area.y, visao[1]), visao[3] - altura),
    largura,
    altura,
  };
}
