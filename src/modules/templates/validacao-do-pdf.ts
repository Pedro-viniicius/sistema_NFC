// Validação do PDF enviado como template de impressão. Feita SEMPRE no servidor, sobre os bytes
// reais: o nome do arquivo, a extensão e o Content-Type informados pelo navegador não são confiáveis.
// Nada do PDF é executado: o arquivo é apenas lido.
import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFPageLeaf,
} from "pdf-lib";
import { ErroDeDominio } from "@/lib/erros";
import { alturaDaCaixa, caixaVisivel, larguraDaCaixa, ptToMm } from "./coordenadas";
import { formatarDimensoesMm } from "./formato";
import type { CaixaPt } from "./tipos";

/** Tamanho máximo do PDF de um template. */
export const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;
/** Limites de bom senso para o lado da página. Fora disso, o arquivo não é a arte de um cartão. */
export const LADO_MINIMO_DA_PAGINA_MM = 20;
export const LADO_MAXIMO_DA_PAGINA_MM = 2000;

export const MENSAGEM_DE_UMA_PAGINA = "O template deve possuir apenas uma página.";
export const MENSAGEM_DE_ROTACAO =
  "Páginas rotacionadas ainda não são suportadas. Exporte o PDF sem rotação.";

const TAMANHO_MAXIMO_DO_NOME = 120;
const ASSINATURA_DO_PDF = "%PDF-";

export type Orientacao = "retrato" | "paisagem" | "quadrada";

export interface PdfDeTemplateValidado {
  /** Nome original, já sem caracteres perigosos. Só para exibição: nunca vira caminho de arquivo. */
  arquivoNomeOriginal: string;
  tamanhoBytes: number;
  sha256: string;
  numeroDePaginas: 1;
  rotacao: 0;
  mediaBox: CaixaPt;
  /** CropBox declarada (ou a MediaBox, quando o PDF não declara uma). */
  cropBox: CaixaPt;
  trimBox: CaixaPt | null;
  bleedBox: CaixaPt | null;
  /** Tamanho da página visível (CropBox limitada à MediaBox), em mm. */
  larguraDaPaginaMm: number;
  alturaDaPaginaMm: number;
  orientacao: Orientacao;
}

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("TEMPLATE_INVALIDO", mensagem);
}

/** Tira do nome tudo o que não deve ir para a tela, para um cabeçalho HTTP ou para um log. */
export function limparNomeDoArquivo(nome: string): string {
  const semCaminho = nome.split(/[\\/]/).pop() ?? "";
  const limpo = semCaminho
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>"'`|:*?]/g, "")
    .trim()
    .slice(-TAMANHO_MAXIMO_DO_NOME)
    .trim();
  return limpo.length > 0 ? limpo : "template.pdf";
}

export function calcularSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function comecaCom(bytes: Uint8Array, texto: string): boolean {
  if (bytes.length < texto.length) return false;
  for (let i = 0; i < texto.length; i++) {
    if (bytes[i] !== texto.charCodeAt(i)) return false;
  }
  return true;
}

/** Todo PDF íntegro termina com o marcador %%EOF (tolerando espaços e lixo curto no fim). */
function terminaComFimDeArquivo(bytes: Uint8Array): boolean {
  const cauda = Buffer.from(bytes.subarray(Math.max(bytes.length - 1024, 0))).toString("latin1");
  return cauda.includes("%%EOF") && cauda.includes("startxref");
}

function numero(contexto: PDFContext, objeto: PDFObject | undefined): number | null {
  const valor = objeto ? contexto.lookup(objeto) : undefined;
  return valor instanceof PDFNumber && Number.isFinite(valor.asNumber()) ? valor.asNumber() : null;
}

/** Lê uma caixa de página e a normaliza para [x0, y0, x1, y1] com x0 < x1 e y0 < y1. */
export function lerCaixaDaPagina(contexto: PDFContext, objeto: PDFObject | undefined): CaixaPt | null {
  const lista = objeto ? contexto.lookup(objeto) : undefined;
  if (!(lista instanceof PDFArray) || lista.size() !== 4) return null;
  const [a, b, c, d] = lista.asArray().map((item) => numero(contexto, item));
  if (a === null || b === null || c === null || d === null) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function mesmaCaixa(a: CaixaPt, b: CaixaPt): boolean {
  return a.every((valor, indice) => Math.abs(valor - b[indice]) < 0.01);
}

const ACOES_PROIBIDAS = new Map([
  ["JavaScript", "JavaScript"],
  ["Launch", "uma ação que abre programas ou arquivos (Launch)"],
  ["ImportData", "uma ação de importação de dados"],
  ["SubmitForm", "uma ação de envio de formulário"],
  ["Rendition", "uma ação de mídia"],
]);

/**
 * Procura conteúdo ativo em TODOS os objetos do arquivo (inclusive os que não estão ligados à
 * página): scripts, ações de execução e arquivos anexados. Devolve a descrição do que encontrou.
 */
function procurarConteudoAtivo(contexto: PDFContext): string | null {
  const pendentes: PDFObject[] = contexto.enumerateIndirectObjects().map(([, objeto]) => objeto);
  const vistos = new Set<PDFObject>();

  for (let objeto = pendentes.pop(); objeto !== undefined; objeto = pendentes.pop()) {
    if (vistos.has(objeto)) continue;
    vistos.add(objeto);

    if (objeto instanceof PDFStream) {
      pendentes.push(objeto.dict);
    } else if (objeto instanceof PDFDict) {
      const tipoDeAcao = objeto.get(PDFName.of("S"));
      if (tipoDeAcao instanceof PDFName) {
        const proibida = ACOES_PROIBIDAS.get(tipoDeAcao.decodeText());
        if (proibida) return proibida;
      }
      if (objeto.has(PDFName.of("JS")) || objeto.has(PDFName.of("JavaScript"))) return "JavaScript";
      const tipo = objeto.get(PDFName.of("Type"));
      const anexo =
        objeto.has(PDFName.of("EmbeddedFiles")) ||
        objeto.has(PDFName.of("EF")) ||
        (tipo instanceof PDFName && tipo.decodeText() === "EmbeddedFile");
      if (anexo) return "arquivos anexados";
      for (const valor of objeto.values()) pendentes.push(valor);
    } else if (objeto instanceof PDFArray) {
      for (const item of objeto.asArray()) pendentes.push(item);
    }
  }
  return null;
}

/** Referências dos fluxos de conteúdo da página, na ordem. */
function fluxosDeConteudo(contexto: PDFContext, pagina: PDFPageLeaf): PDFStream[] {
  const conteudo = contexto.lookup(pagina.get(PDFName.of("Contents")));
  if (conteudo === undefined) return [];
  const itens = conteudo instanceof PDFArray ? conteudo.asArray().map((item) => contexto.lookup(item)) : [conteudo];
  return itens.map((item) => {
    if (!(item instanceof PDFStream)) throw new Error("fluxo de conteúdo ausente");
    return item;
  });
}

interface PaginaLida {
  mediaBox: CaixaPt;
  cropBox: CaixaPt;
  trimBox: CaixaPt | null;
  bleedBox: CaixaPt | null;
}

function lerPagina(documento: PDFDocument): PaginaLida {
  const contexto = documento.context;
  const pagina = documento.getPage(0).node;

  const rotacao = numero(contexto, pagina.getInheritableAttribute(PDFName.of("Rotate"))) ?? 0;
  if (((rotacao % 360) + 360) % 360 !== 0) throw falha(MENSAGEM_DE_ROTACAO);

  const unidade = numero(contexto, pagina.get(PDFName.of("UserUnit"))) ?? 1;
  if (Math.abs(unidade - 1) > 1e-9) {
    throw falha("Este PDF usa uma unidade de página personalizada (UserUnit), que não é suportada. Exporte-o novamente em tamanho real.");
  }

  const mediaBox = lerCaixaDaPagina(contexto, pagina.getInheritableAttribute(PDFName.of("MediaBox")));
  if (!mediaBox) throw falha("O PDF não informa o tamanho da página (MediaBox). Exporte o arquivo novamente.");
  const cropBox = lerCaixaDaPagina(contexto, pagina.getInheritableAttribute(PDFName.of("CropBox"))) ?? mediaBox;

  // O conteúdo da página precisa existir e poder ser lido: um arquivo cortado costuma falhar aqui.
  for (const fluxo of fluxosDeConteudo(contexto, pagina)) {
    if (fluxo instanceof PDFRawStream) decodePDFRawStream(fluxo).decode();
  }

  return {
    mediaBox,
    cropBox,
    trimBox: lerCaixaDaPagina(contexto, pagina.get(PDFName.of("TrimBox"))),
    bleedBox: lerCaixaDaPagina(contexto, pagina.get(PDFName.of("BleedBox"))),
  };
}

/**
 * Valida o PDF de um template e extrai os metadados da página. Lança ErroDeDominio
 * (TEMPLATE_INVALIDO) com uma mensagem clara para o administrador quando o arquivo não serve.
 */
export async function validarPdfDoTemplate(
  bytes: Uint8Array,
  nomeInformado: string,
): Promise<PdfDeTemplateValidado> {
  const arquivoNomeOriginal = limparNomeDoArquivo(nomeInformado);
  if (!/\.pdf$/i.test(arquivoNomeOriginal)) {
    throw falha("O arquivo deve ser um PDF (extensão .pdf).");
  }
  if (bytes.length === 0) throw falha("O arquivo está vazio.");
  if (bytes.length > MAX_TEMPLATE_BYTES) {
    throw falha(
      `O arquivo tem ${(bytes.length / 1024 / 1024).toFixed(1).replace(".", ",")} MB. ` +
        `O tamanho máximo de um template é ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (!comecaCom(bytes, ASSINATURA_DO_PDF)) {
    throw falha("O arquivo enviado não é um PDF, apesar da extensão.");
  }
  if (!terminaComFimDeArquivo(bytes)) {
    throw falha("O PDF está incompleto ou corrompido. Exporte o arquivo novamente e envie de novo.");
  }

  let documento: PDFDocument;
  try {
    // Sem `ignoreEncryption`: um PDF protegido por senha é recusado, nunca aberto à força.
    documento = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (erro) {
    if (erro instanceof Error && /encrypt/i.test(`${erro.name} ${erro.message}`)) {
      throw falha("O PDF está protegido por senha ou criptografado. Exporte o arquivo sem proteção.");
    }
    throw falha("O PDF está malformado e não pôde ser lido. Exporte o arquivo novamente.");
  }

  let numeroDePaginas: number;
  try {
    numeroDePaginas = documento.getPageCount();
  } catch {
    throw falha("O PDF está malformado e não pôde ser lido. Exporte o arquivo novamente.");
  }
  // Nunca usamos "só a primeira página" em silêncio: o arquivo inteiro precisa ser a arte.
  if (numeroDePaginas !== 1) throw falha(MENSAGEM_DE_UMA_PAGINA);

  let pagina: PaginaLida;
  let conteudoAtivo: string | null;
  try {
    pagina = lerPagina(documento);
    conteudoAtivo = procurarConteudoAtivo(documento.context);
  } catch (erro) {
    if (erro instanceof ErroDeDominio) throw erro;
    throw falha("O PDF está malformado e não pôde ser lido. Exporte o arquivo novamente.");
  }
  if (conteudoAtivo) {
    throw falha(
      `O PDF contém conteúdo ativo (${conteudoAtivo}), que não é aceito em templates. ` +
        "Exporte a arte novamente sem scripts, ações ou anexos.",
    );
  }

  const visivel = caixaVisivel(pagina.mediaBox, pagina.cropBox);
  const larguraDaPaginaMm = ptToMm(larguraDaCaixa(visivel));
  const alturaDaPaginaMm = ptToMm(alturaDaCaixa(visivel));
  const ladoValido = (mm: number) => mm >= LADO_MINIMO_DA_PAGINA_MM && mm <= LADO_MAXIMO_DA_PAGINA_MM;
  if (!ladoValido(larguraDaPaginaMm) || !ladoValido(alturaDaPaginaMm)) {
    throw falha(
      `A página do PDF tem dimensões fora do aceito (${formatarDimensoesMm(larguraDaPaginaMm, alturaDaPaginaMm)}). ` +
        `Cada lado deve ter entre ${LADO_MINIMO_DA_PAGINA_MM} mm e ${LADO_MAXIMO_DA_PAGINA_MM} mm.`,
    );
  }

  return {
    arquivoNomeOriginal,
    tamanhoBytes: bytes.length,
    sha256: calcularSha256(bytes),
    numeroDePaginas: 1,
    rotacao: 0,
    ...pagina,
    larguraDaPaginaMm,
    alturaDaPaginaMm,
    orientacao: orientacaoDaPagina(larguraDaPaginaMm, alturaDaPaginaMm),
  };
}

export function orientacaoDaPagina(larguraMm: number, alturaMm: number): Orientacao {
  const diferenca = larguraMm - alturaMm;
  return Math.abs(diferenca) < 0.01 ? "quadrada" : diferenca > 0 ? "paisagem" : "retrato";
}

type DadosParaDescricao = Pick<
  PdfDeTemplateValidado,
  "arquivoNomeOriginal" | "larguraDaPaginaMm" | "alturaDaPaginaMm" | "mediaBox" | "trimBox"
>;

/** Ex.: "cartao_google.pdf · 1 página · 130,05 × 86,70 mm · paisagem". */
export function descreverPdfDoTemplate(pdf: DadosParaDescricao): string {
  const partes = [
    pdf.arquivoNomeOriginal,
    "1 página",
    formatarDimensoesMm(pdf.larguraDaPaginaMm, pdf.alturaDaPaginaMm),
    orientacaoDaPagina(pdf.larguraDaPaginaMm, pdf.alturaDaPaginaMm),
  ];
  if (pdf.trimBox && !mesmaCaixa(pdf.trimBox, pdf.mediaBox)) {
    partes.push(
      `área de corte (TrimBox) de ${formatarDimensoesMm(
        ptToMm(larguraDaCaixa(pdf.trimBox)),
        ptToMm(alturaDaCaixa(pdf.trimBox)),
      )}`,
    );
  }
  return partes.join(" · ");
}
