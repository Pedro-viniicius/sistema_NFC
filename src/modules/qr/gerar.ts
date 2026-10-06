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

/** Matriz do QR: `linhas[linha][coluna]` é verdadeiro nos módulos escuros. Não inclui a zona de silêncio. */
export interface MatrizDoQr {
  /** Quantidade de módulos por lado (ex.: 29 na versão 3). */
  lado: number;
  linhas: boolean[][];
}

/** Sequência horizontal de módulos escuros, usada para desenhar o QR como retângulos vetoriais. */
export interface FaixaDeModulos {
  linha: number;
  coluna: number;
  largura: number;
}

/**
 * Matriz de módulos do QR do cartão. É a base de toda saída vetorial (SVG e PDF de impressão),
 * então o QR do arquivo avulso e o da arte final são sempre o mesmo desenho.
 */
export function gerarMatrizDoQr(codigo: string): MatrizDoQr {
  const { modules } = QRCode.create(conteudoDoQr(codigo), {
    errorCorrectionLevel: OPCOES_DO_QR.errorCorrectionLevel,
  });
  const lado = modules.size;
  const linhas = Array.from({ length: lado }, (_, linha) =>
    Array.from({ length: lado }, (_, coluna) => modules.data[linha * lado + coluna] === 1),
  );
  return { lado, linhas };
}

/** Junta módulos escuros vizinhos da mesma linha em faixas: menos formas e nenhuma emenda entre módulos. */
export function agruparEmFaixas(matriz: MatrizDoQr): FaixaDeModulos[] {
  const faixas: FaixaDeModulos[] = [];
  matriz.linhas.forEach((modulos, linha) => {
    let inicio = -1;
    for (let coluna = 0; coluna <= matriz.lado; coluna++) {
      const escuro = coluna < matriz.lado && modulos[coluna];
      if (escuro && inicio < 0) inicio = coluna;
      if (!escuro && inicio >= 0) {
        faixas.push({ linha, coluna: inicio, largura: coluna - inicio });
        inicio = -1;
      }
    }
  });
  return faixas;
}

/**
 * SVG vetorial: formato preferido para impressão profissional.
 * Os módulos são retângulos preenchidos (não traços), para o QR não se deformar quando o arquivo
 * é redimensionado em programas de editoração. A unidade do viewBox é o módulo.
 */
export async function gerarQrSvg(codigo: string): Promise<string> {
  const matriz = gerarMatrizDoQr(codigo);
  const margem = ZONA_DE_SILENCIO_EM_MODULOS;
  const lado = matriz.lado + 2 * margem;
  const caminho = agruparEmFaixas(matriz)
    .map((faixa) => `M${faixa.coluna + margem} ${faixa.linha + margem}h${faixa.largura}v1h-${faixa.largura}z`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges">` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${caminho}"/>` +
    `</svg>\n`
  );
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
