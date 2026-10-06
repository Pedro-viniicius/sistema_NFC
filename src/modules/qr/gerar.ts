// Geração de QR Code. As funções recebem APENAS o código do cartão e codificam a URL permanente:
// não existe caminho no sistema para gerar um QR com o destino final (Instagram, Google etc.).
import QRCode from "qrcode";
import { getCardPublicUrl } from "@/modules/cards/url-publica";

/**
 * Correção de erro "M" (15%): suficiente para impressão limpa e mantém o QR pouco denso,
 * o que facilita a leitura em adesivos pequenos. Margem de 4 módulos = zona de silêncio do padrão.
 * Preto sobre branco, sem logotipo e sem estilização.
 */
const OPCOES_DO_QR = { errorCorrectionLevel: "M", margin: 4 } as const;

export const ZONA_DE_SILENCIO_EM_MODULOS = OPCOES_DO_QR.margin;

export type FormatoDeQr = "svg" | "png";

/** Conteúdo codificado no QR: sempre a URL permanente, a mesma gravada no NFC. */
export function conteudoDoQr(codigo: string): string {
  return getCardPublicUrl(codigo);
}

/** SVG vetorial: formato preferido para impressão profissional. */
export function gerarQrSvg(codigo: string): Promise<string> {
  return QRCode.toString(conteudoDoQr(codigo), { ...OPCOES_DO_QR, type: "svg" });
}

export function gerarQrPng(codigo: string, larguraEmPixels = 1024): Promise<Buffer> {
  return QRCode.toBuffer(conteudoDoQr(codigo), {
    ...OPCOES_DO_QR,
    type: "png",
    width: larguraEmPixels,
  });
}

export function nomeDoArquivoQr(codigo: string, formato: FormatoDeQr): string {
  return `qr-${codigo}.${formato}`;
}
