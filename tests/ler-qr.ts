import jsQR from "jsqr";
import { PNG } from "pngjs";

/** Lê o QR de verdade (como um celular faria) e devolve o texto codificado. */
export function lerQrDoPng(png: Buffer): string | null {
  const imagem = PNG.sync.read(png);
  const leitura = jsQR(new Uint8ClampedArray(imagem.data), imagem.width, imagem.height);
  return leitura?.data ?? null;
}

const PIXELS_POR_MODULO = 8;

/**
 * Lê um QR a partir de uma grade de módulos (verdadeiro = escuro). A grade deve incluir a zona de
 * silêncio. Converte em imagem e decodifica, como faria a câmera de um celular.
 */
export function lerQrDaGrade(grade: readonly (readonly boolean[])[]): string | null {
  const lado = grade.length * PIXELS_POR_MODULO;
  const pixels = new Uint8ClampedArray(lado * lado * 4).fill(255);
  grade.forEach((linha, y) =>
    linha.forEach((escuro, x) => {
      if (!escuro) return;
      for (let dy = 0; dy < PIXELS_POR_MODULO; dy++) {
        for (let dx = 0; dx < PIXELS_POR_MODULO; dx++) {
          const i = ((y * PIXELS_POR_MODULO + dy) * lado + x * PIXELS_POR_MODULO + dx) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(pixels, lado, lado)?.data ?? null;
}

export function gradeVazia(lado: number): boolean[][] {
  return Array.from({ length: lado }, () => Array<boolean>(lado).fill(false));
}

/** Lê o QR de um SVG gerado pelo sistema, reconstruindo os módulos a partir dos retângulos do desenho. */
export function lerQrDoSvg(svg: string): string | null {
  const lado = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  if (!Number.isInteger(lado)) return null;
  const grade = gradeVazia(lado);
  for (const [, x, y, largura] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(largura); i++) grade[Number(y)][Number(x) + i] = true;
  }
  return lerQrDaGrade(grade);
}
