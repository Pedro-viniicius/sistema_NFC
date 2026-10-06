// Exportação do lote para a gráfica: CSV + um SVG por cartão, gerados sob demanda (nada vai para disco).
import JSZip from "jszip";
import type { Cartao, Lote } from "@/db/schema";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { gerarQrSvg } from "@/modules/qr/gerar";

export const NOME_DO_CSV = "lote.csv";

/** Nome do SVG dentro da pasta do lote, ex.: K8M4T2.svg. */
export function arquivoQrNoLote(codigo: string): string {
  return `${codigo}.svg`;
}

/**
 * CSV de dados variáveis: código, URL permanente, tipo e o arquivo de QR correspondente.
 * Todos os valores vêm de alfabetos controlados (sem vírgulas, aspas ou fórmulas).
 */
export function gerarCsvDoLote(cartoes: readonly Cartao[]): string {
  const linhas = cartoes.map((cartao) =>
    [
      cartao.codigo,
      getCardPublicUrl(cartao.codigo),
      cartao.tipo ?? "",
      arquivoQrNoLote(cartao.codigo),
    ].join(","),
  );
  return ["codigo,url,tipo,arquivo_qr", ...linhas].join("\r\n") + "\r\n";
}

/**
 * ZIP para a gráfica:
 *   lote-2026-001/
 *     K8M4T2.svg
 *     7PN3RX.svg
 *     lote.csv
 */
export async function gerarZipDoLote(lote: Lote, cartoes: readonly Cartao[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const pasta = zip.folder(lote.identificador);
  if (!pasta) throw new Error("Não foi possível criar a pasta do lote no arquivo ZIP.");

  for (const cartao of cartoes) {
    pasta.file(arquivoQrNoLote(cartao.codigo), await gerarQrSvg(cartao.codigo));
  }
  pasta.file(NOME_DO_CSV, gerarCsvDoLote(cartoes));

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
