// Leitura estrutural dos PDFs gerados a partir de um template: caixas das páginas, fluxos de
// conteúdo (bytes brutos, como estão no arquivo) e o desenho vetorial do QR.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
} from "pdf-lib";
import type { RetanguloPt } from "@/modules/templates/tipos";
import { gradeVazia, lerQrDaGrade } from "./ler-qr";

export const NOMES_DAS_CAIXAS = ["MediaBox", "CropBox", "TrimBox", "BleedBox"] as const;
export type CaixasDaPagina = Record<(typeof NOMES_DAS_CAIXAS)[number], number[] | null>;

export interface FluxoBruto {
  referencia: string;
  /** Bytes exatamente como gravados no arquivo (ainda comprimidos, se o fluxo for comprimido). */
  bytes: Uint8Array;
  /** Dicionário do fluxo, como texto (filtro, largura, espaço de cor…). */
  dicionario: string;
}

export interface DesenhoDoQr {
  /** Quadrado branco desenhado sob o QR. */
  fundo: RetanguloPt;
  /** Menor retângulo que contém todos os módulos escuros. */
  modulos: RetanguloPt;
  /** Lado de um módulo, em pontos. */
  modulo: number;
  /** Quantidade de blocos retangulares de módulos no desenho. */
  blocos: number;
  /** Texto lido da grade de módulos reconstruída a partir do desenho. */
  conteudo: string | null;
  /** Operadores de cor usados no bloco do QR. */
  cores: string[];
  /** Quantidade de operadores de preenchimento e de traço dentro do bloco. */
  preenchimentos: number;
  tracos: number;
  operadores: string;
}

export interface PaginaDoPdf {
  caixas: CaixasDaPagina;
  /** Fluxos de conteúdo, na ordem em que são desenhados. */
  conteudo: FluxoBruto[];
  /** Imagens e outros XObjects dos recursos da página. */
  xobjects: FluxoBruto[];
  rotacao: number;
  /** Nomes das entradas do dicionário da página. */
  entradas: string[];
}

function fluxoBruto(contexto: PDFContext, referencia: unknown): FluxoBruto {
  if (!(referencia instanceof PDFRef)) throw new Error("Esperava uma referência a um fluxo.");
  const fluxo = contexto.lookup(referencia);
  if (!(fluxo instanceof PDFRawStream)) throw new Error("Esperava um fluxo no PDF.");
  return { referencia: referencia.toString(), bytes: fluxo.contents, dicionario: fluxo.dict.toString() };
}

function lerCaixa(contexto: PDFContext, pagina: PDFPageLeaf, nome: string): number[] | null {
  const valor = contexto.lookup(pagina.get(PDFName.of(nome)));
  if (!(valor instanceof PDFArray)) return null;
  return valor.asArray().map((item) => {
    const numero = contexto.lookup(item);
    if (!(numero instanceof PDFNumber)) throw new Error(`Caixa ${nome} inválida.`);
    return numero.asNumber();
  });
}

function lerPagina(contexto: PDFContext, pagina: PDFPageLeaf): PaginaDoPdf {
  const conteudo = contexto.lookup(pagina.get(PDFName.of("Contents")));
  const referencias =
    conteudo instanceof PDFArray ? conteudo.asArray() : conteudo ? [pagina.get(PDFName.of("Contents"))] : [];

  const recursos = contexto.lookup(pagina.get(PDFName.of("Resources")));
  const objetos = recursos instanceof PDFDict ? recursos.lookup(PDFName.of("XObject")) : undefined;
  const rotacao = contexto.lookup(pagina.get(PDFName.of("Rotate")));

  return {
    caixas: Object.fromEntries(
      NOMES_DAS_CAIXAS.map((nome) => [nome, lerCaixa(contexto, pagina, nome)]),
    ) as CaixasDaPagina,
    conteudo: referencias.map((referencia) => fluxoBruto(contexto, referencia)),
    xobjects: objetos instanceof PDFDict ? objetos.values().map((referencia) => fluxoBruto(contexto, referencia)) : [],
    rotacao: rotacao instanceof PDFNumber ? rotacao.asNumber() : 0,
    entradas: pagina.keys().map((nome) => nome.decodeText()).sort(),
  };
}

/** Páginas do PDF, lidas diretamente da árvore de páginas (sem alterar nada no documento). */
export async function lerPaginasDoPdf(pdf: Uint8Array): Promise<PaginaDoPdf[]> {
  const documento = await PDFDocument.load(pdf, { updateMetadata: false });
  const paginas: PaginaDoPdf[] = [];
  documento.catalog.Pages().traverse((no) => {
    if (no instanceof PDFPageLeaf) paginas.push(lerPagina(documento.context, no));
  });
  return paginas;
}

export function decodificarFluxo(pdf: PDFDocument, referencia: PDFRef): string {
  const fluxo = pdf.context.lookup(referencia);
  if (!(fluxo instanceof PDFRawStream)) throw new Error("Esperava um fluxo no PDF.");
  return Buffer.from(decodePDFRawStream(fluxo).decode()).toString("latin1");
}

const NUMERO = "(-?\\d+(?:\\.\\d+)?)";
const RETANGULO = new RegExp(`^${NUMERO} ${NUMERO} ${NUMERO} ${NUMERO} re$`, "gm");
const MATRIZ = new RegExp(`^${NUMERO} 0 0 -${NUMERO} ${NUMERO} ${NUMERO} cm$`, "m");

/** Lê o desenho vetorial do QR de cada página: o último fluxo de conteúdo, entre /QRCode BMC e EMC. */
export async function lerDesenhosDoQr(pdf: Uint8Array): Promise<DesenhoDoQr[]> {
  const documento = await PDFDocument.load(pdf, { updateMetadata: false });
  const desenhos: DesenhoDoQr[] = [];

  documento.catalog.Pages().traverse((no) => {
    if (!(no instanceof PDFPageLeaf)) return;
    const conteudo = documento.context.lookup(no.get(PDFName.of("Contents")));
    if (!(conteudo instanceof PDFArray)) throw new Error("A página não tem a lista de conteúdos esperada.");
    const ultimo = conteudo.asArray().at(-1);
    if (!(ultimo instanceof PDFRef)) throw new Error("Conteúdo inesperado na página.");

    const operadores = decodificarFluxo(documento, ultimo);
    const bloco = /\/QRCode BMC([\s\S]*?)EMC/.exec(operadores)?.[1];
    if (!bloco) throw new Error("A página não tem um bloco de QR Code.");

    // Primeiro retângulo: o fundo branco, em pontos. Os demais: blocos de módulos, na grade do QR
    // (1 unidade = 1 módulo, origem no canto superior esquerdo, y para baixo), posicionada pela matriz.
    const [fundo, ...blocos] = [...bloco.matchAll(RETANGULO)].map((m) => m.slice(1, 5).map(Number));
    const matriz = MATRIZ.exec(bloco);
    if (!fundo || !matriz || blocos.length === 0) throw new Error("O bloco do QR não tem o desenho esperado.");
    const [modulo, moduloY, esquerda, topo] = matriz.slice(1, 5).map(Number);
    if (modulo !== moduloY) throw new Error("Os módulos do QR não são quadrados.");

    const lado = Math.max(...blocos.map(([coluna, , largura]) => coluna + largura));
    const altura = Math.max(...blocos.map(([, linha, , alturaDoBloco]) => linha + alturaDoBloco));
    const primeiraColuna = Math.min(...blocos.map(([coluna]) => coluna));
    const primeiraLinha = Math.min(...blocos.map(([, linha]) => linha));
    if (!blocos.flat().every(Number.isInteger)) throw new Error("Os blocos do QR não estão na grade de módulos.");

    // Reconstrói a grade (com 4 módulos de margem) e lê o QR a partir dela.
    const margem = 4;
    const grade = gradeVazia(Math.max(lado, altura) + 2 * margem);
    for (const [coluna, linha, largura, alturaDoBloco] of blocos) {
      for (let dy = 0; dy < alturaDoBloco; dy++) {
        for (let dx = 0; dx < largura; dx++) grade[margem + linha + dy][margem + coluna + dx] = true;
      }
    }

    desenhos.push({
      fundo: { x: fundo[0], y: fundo[1], largura: fundo[2], altura: fundo[3] },
      modulos: {
        x: esquerda + primeiraColuna * modulo,
        y: topo - altura * modulo,
        largura: (lado - primeiraColuna) * modulo,
        altura: (altura - primeiraLinha) * modulo,
      },
      modulo,
      blocos: blocos.length,
      conteudo: lerQrDaGrade(grade),
      cores: [...bloco.matchAll(/[\d. ]+ (?:k|K|rg|RG|g|G)\b/g)].map((m) => m[0].trim()),
      preenchimentos: [...bloco.matchAll(/^f\*?$/gm)].length,
      tracos: [...bloco.matchAll(/^(?:S|s|B|b|B\*|b\*)$/gm)].length,
      operadores,
    });
  });
  return desenhos;
}
