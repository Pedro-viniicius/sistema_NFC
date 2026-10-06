import jsQR from "jsqr";
import { PNG } from "pngjs";

/** Lê o QR de verdade (como um celular faria) e devolve o texto codificado. */
export function lerQrDoPng(png: Buffer): string | null {
  const imagem = PNG.sync.read(png);
  const leitura = jsQR(new Uint8ClampedArray(imagem.data), imagem.width, imagem.height);
  return leitura?.data ?? null;
}
