// Leitura dos PDFs de impressão nos testes: abre o arquivo gerado e reconstrói o QR
// a partir dos retângulos realmente desenhados na página.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFPage } from "pdf-lib";
import { gradeVazia, lerQrDaGrade } from "./ler-qr";

export interface RetanguloNoPdf {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface PaginaDeImpressao {
  /** Texto codificado no QR desenhado na página. */
  conteudoDoQr: string | null;
  /** Quadrado do QR com a zona de silêncio, em pontos. */
  areaDoQr: RetanguloNoPdf;
  /** Menor distância, em módulos, entre a borda da área e o primeiro módulo escuro. */
  zonaDeSilencioEmModulos: number;
  /** Operadores de cor usados dentro do bloco do QR. */
  coresDoQr: string[];
  midia: RetanguloNoPdf;
  corte: RetanguloNoPdf;
  sangria: RetanguloNoPdf;
  /** Conteúdo (decodificado) da arte fixa embutida na página. */
  arteEmbutida: string;
  /** Conteúdo completo da página, para verificações adicionais. */
  operadores: string;
}

function decodificar(fluxo: unknown): string {
  if (!(fluxo instanceof PDFRawStream)) throw new Error("Fluxo de conteúdo inesperado no PDF.");
  return Buffer.from(decodePDFRawStream(fluxo).decode()).toString("latin1");
}

function conteudoDaPagina(pagina: PDFPage): string {
  const conteudo = pagina.node.Contents();
  if (conteudo instanceof PDFArray) {
    return conteudo
      .asArray()
      .map((referencia) => decodificar(pagina.doc.context.lookup(referencia)))
      .join("\n");
  }
  return decodificar(conteudo);
}

function arteEmbutida(pagina: PDFPage): string {
  const objetos = pagina.node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(objetos instanceof PDFDict)) return "";
  return objetos
    .keys()
    .map((nome) => decodificar(objetos.lookup(nome)))
    .join("\n");
}

function caixa({ x, y, width, height }: { x: number; y: number; width: number; height: number }): RetanguloNoPdf {
  return { x, y, largura: width, altura: height };
}

function lerPagina(pagina: PDFPage): PaginaDeImpressao {
  const operadores = conteudoDaPagina(pagina);
  const bloco = /\/QRCode BMC([\s\S]*?)EMC/.exec(operadores)?.[1];
  if (!bloco) throw new Error("A página não tem um bloco de QR Code.");

  const retangulos = [...bloco.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    largura: Number(m[3]),
    altura: Number(m[4]),
  }));
  const [areaDoQr, ...modulos] = retangulos;
  const modulo = modulos[0].altura;
  const lado = Math.round(areaDoQr.largura / modulo);

  const grade = gradeVazia(lado);
  let zona = lado;
  for (const faixa of modulos) {
    const coluna = Math.round((faixa.x - areaDoQr.x) / modulo);
    const linha = Math.round((areaDoQr.y + areaDoQr.altura - faixa.y - faixa.altura) / modulo);
    const largura = Math.round(faixa.largura / modulo);
    for (let i = 0; i < largura; i++) grade[linha][coluna + i] = true;
    zona = Math.min(zona, coluna, linha, lado - (coluna + largura), lado - 1 - linha);
  }

  return {
    conteudoDoQr: lerQrDaGrade(grade),
    areaDoQr,
    zonaDeSilencioEmModulos: zona,
    coresDoQr: [...bloco.matchAll(/[\d. ]+ (?:k|K|rg|RG|g|G)\b/g)].map((m) => m[0].trim()),
    midia: caixa(pagina.getMediaBox()),
    corte: caixa(pagina.getTrimBox()),
    sangria: caixa(pagina.getBleedBox()),
    arteEmbutida: arteEmbutida(pagina),
    operadores,
  };
}

export async function lerPdfDeImpressao(pdf: Uint8Array | ArrayBuffer): Promise<PaginaDeImpressao[]> {
  const documento = await PDFDocument.load(pdf);
  return documento.getPages().map(lerPagina);
}

/** Conteúdo (decodificado) da página única de um arquivo de arte fixa em templates/. */
export async function lerArteDoModelo(pdf: Uint8Array): Promise<string> {
  const documento = await PDFDocument.load(pdf);
  return conteudoDaPagina(documento.getPage(0));
}
