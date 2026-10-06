// Renderiza páginas de PDF nos testes (pdf.js + @napi-rs/canvas) e lê o QR da imagem com o jsQR,
// como a câmera de um celular faria. É uma verificação independente do gerador: se a arte deslocar
// o QR, se ele sair cortado ou fora do lugar, a leitura ou a posição não conferem.
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RetanguloPt } from "@/modules/templates/tipos";

const FONTES_PADRAO = `${path.join("node_modules", "pdfjs-dist", "standard_fonts")}${path.sep}`;

export interface PaginaRenderizada {
  largura: number;
  altura: number;
  /** RGBA, 4 bytes por pixel. */
  pixels: Uint8ClampedArray;
  /** `page.view` do pdf.js: a página visível, em pontos. */
  visao: [number, number, number, number];
  /** Converte um ponto da imagem (px) para o espaço do usuário da página (pontos). */
  paraPontos(x: number, y: number): [number, number];
}

export interface QrLido {
  conteudo: string;
  /** Menor retângulo, em pontos, que contém os quatro cantos do QR encontrados na imagem. */
  regiao: RetanguloPt;
}

function abrir(pdf: Uint8Array) {
  // O pdf.js toma posse do buffer recebido: entregamos uma cópia.
  return getDocument({ data: Uint8Array.from(pdf), standardFontDataUrl: FONTES_PADRAO, verbosity: 0 });
}

export async function contarPaginas(pdf: Uint8Array): Promise<number> {
  const tarefa = abrir(pdf);
  try {
    return (await tarefa.promise).numPages;
  } finally {
    await tarefa.destroy();
  }
}

export async function renderizarPagina(pdf: Uint8Array, numero = 1, pontosPorPolegada = 300): Promise<PaginaRenderizada> {
  const tarefa = abrir(pdf);
  try {
    const pagina = await (await tarefa.promise).getPage(numero);
    const viewport = pagina.getViewport({ scale: pontosPorPolegada / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const contexto = canvas.getContext("2d");
    await pagina.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: contexto as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const imagem = contexto.getImageData(0, 0, canvas.width, canvas.height);
    return {
      largura: canvas.width,
      altura: canvas.height,
      pixels: new Uint8ClampedArray(imagem.data),
      visao: pagina.view as [number, number, number, number],
      paraPontos: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
    };
  } finally {
    await tarefa.destroy();
  }
}

/** Lê o QR da página renderizada. Devolve null se nenhum QR for encontrado. */
export async function lerQrDaPagina(pdf: Uint8Array, numero = 1): Promise<QrLido | null> {
  const pagina = await renderizarPagina(pdf, numero);
  const leitura = jsQR(pagina.pixels, pagina.largura, pagina.altura);
  if (!leitura) return null;

  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = leitura.location;
  const cantos = [topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner].map((canto) =>
    pagina.paraPontos(canto.x, canto.y),
  );
  const xs = cantos.map(([x]) => x);
  const ys = cantos.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    conteudo: leitura.data,
    regiao: { x, y, largura: Math.max(...xs) - x, altura: Math.max(...ys) - y },
  };
}

/**
 * Compara duas páginas renderizadas e devolve, em pontos, a região onde elas diferem
 * (ou null se forem idênticas). Serve para provar que só a área do QR mudou.
 */
export function regiaoDiferente(a: PaginaRenderizada, b: PaginaRenderizada): RetanguloPt | null {
  if (a.largura !== b.largura || a.altura !== b.altura) throw new Error("As páginas têm tamanhos diferentes.");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < a.altura; y++) {
    for (let x = 0; x < a.largura; x++) {
      const i = (y * a.largura + x) * 4;
      const difere =
        Math.abs(a.pixels[i] - b.pixels[i]) > 2 ||
        Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) > 2 ||
        Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 2;
      if (!difere) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  const [x0, y1] = a.paraPontos(minX, minY);
  const [x1, y0] = a.paraPontos(maxX + 1, maxY + 1);
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}
