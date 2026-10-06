// Arte final de impressão:  ARTE FIXA do modelo  +  QR Code do cartão  =  PDF pronto para a gráfica.
//
// As funções recebem apenas CÓDIGOS de cartão. O gerador não conhece o destino configurado:
// o QR é sempre a URL permanente, obtida pelo módulo de QR a partir de getCardPublicUrl().
import { PDFDocument, cmyk, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";
import { ErroDeDominio } from "@/lib/erros";
import { gerarMatrizDoQr } from "@/modules/qr/gerar";
import { GLIFOS_DO_CODIGO, PASTA_DOS_MODELOS, carregarArteDoModelo } from "./arquivos-do-modelo";
import { desenharQr } from "./desenho-do-qr";
import {
  MODULO_MINIMO_MM,
  geometriaDoModelo,
  tamanhoDoModuloMm,
  validarModelo,
  type GeometriaDoModelo,
  type ModeloDeImpressao,
} from "./modelos";
import { desenharTextoEmCurvas } from "./texto-em-curvas";
import { mmParaPontos, pontosParaMm } from "./unidades";

/** Diferença máxima aceita entre o tamanho da arte e o do modelo (0,05 mm). */
const TOLERANCIA_PT = mmParaPontos(0.05);
const ESPACAMENTO_DO_CODIGO_PT = 0.7;

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("IMPRESSAO_INVALIDA", mensagem);
}

function emMm(pontos: number): string {
  return pontosParaMm(pontos).toFixed(2).replace(".", ",");
}

/** Abre a arte fixa e confere se ela tem exatamente o tamanho do modelo. A arte nunca é redimensionada. */
async function abrirArte(modelo: ModeloDeImpressao, geometria: GeometriaDoModelo): Promise<PDFPage> {
  const caminho = `${PASTA_DOS_MODELOS}/${modelo.arquivo}`;
  const bytes = await carregarArteDoModelo(modelo);

  let arte: PDFDocument;
  try {
    arte = await PDFDocument.load(bytes);
  } catch {
    throw falha(`O arquivo ${caminho} não é um PDF válido.`);
  }
  if (arte.getPageCount() !== 1) {
    throw falha(`O arquivo ${caminho} deve ter exatamente uma página (tem ${arte.getPageCount()}).`);
  }

  const pagina = arte.getPage(0);
  const { width, height } = pagina.getSize();
  if (
    Math.abs(width - geometria.larguraPt) > TOLERANCIA_PT ||
    Math.abs(height - geometria.alturaPt) > TOLERANCIA_PT
  ) {
    throw falha(
      `A arte ${caminho} mede ${emMm(width)} × ${emMm(height)} mm, mas o modelo ${modelo.nome} ` +
        `espera ${emMm(geometria.larguraPt)} × ${emMm(geometria.alturaPt)} mm (com sangria).`,
    );
  }
  return pagina;
}

function desenharCodigo(pagina: PDFPage, codigo: string, modelo: ModeloDeImpressao, geometria: GeometriaDoModelo): void {
  if (!modelo.codigo) return;
  const { corte } = geometria;
  desenharTextoEmCurvas(pagina, codigo, GLIFOS_DO_CODIGO, {
    x: corte.x + mmParaPontos(modelo.codigo.xCentroMm),
    y: corte.y + corte.altura - mmParaPontos(modelo.codigo.linhaDeBaseMm),
    tamanhoPt: modelo.codigo.tamanhoPt,
    cor: modelo.codigo.cor === "branco" ? cmyk(0, 0, 0, 0) : cmyk(0, 0, 0, 1),
    alinhamento: "centro",
    espacamentoPt: ESPACAMENTO_DO_CODIGO_PT,
  });
}

function adicionarPagina(
  documento: PDFDocument,
  arte: PDFEmbeddedPage,
  codigo: string,
  modelo: ModeloDeImpressao,
  geometria: GeometriaDoModelo,
): void {
  const matriz = gerarMatrizDoQr(codigo);
  if (tamanhoDoModuloMm(modelo, matriz) < MODULO_MINIMO_MM) {
    throw falha(
      `O QR Code do cartão ${codigo} ficaria com módulos menores que ${MODULO_MINIMO_MM} mm ` +
        `na área de ${modelo.qr.tamanhoMm} mm do modelo ${modelo.nome}. Aumente a área do QR ou use um domínio mais curto.`,
    );
  }

  const pagina = documento.addPage([geometria.larguraPt, geometria.alturaPt]);
  const { corte } = geometria;
  pagina.setBleedBox(0, 0, geometria.larguraPt, geometria.alturaPt);
  pagina.setTrimBox(corte.x, corte.y, corte.largura, corte.altura);

  // 1) arte fixa, em tamanho real; 2) QR do cartão; 3) código do cartão.
  pagina.drawPage(arte, { x: 0, y: 0, width: geometria.larguraPt, height: geometria.alturaPt });
  desenharQr(pagina, matriz, geometria.qr);
  desenharCodigo(pagina, codigo, modelo, geometria);
}

/**
 * Gera um PDF com uma página por cartão, na ordem recebida. Todas as páginas usam a mesma arte
 * e o mesmo tamanho físico; só o QR (e o código impresso) muda de uma página para outra.
 */
export async function gerarPdfDeImpressao(
  codigos: readonly string[],
  modelo: ModeloDeImpressao,
  titulo: string,
): Promise<Uint8Array> {
  if (codigos.length === 0) {
    throw falha("Não há cartões para gerar a arte de impressão.");
  }
  const problemas = validarModelo(modelo);
  if (problemas.length > 0) throw falha(problemas.join(" "));

  const geometria = geometriaDoModelo(modelo);
  const documento = await PDFDocument.create();
  // A arte é embutida uma única vez e reutilizada em todas as páginas.
  const arte = await documento.embedPage(await abrirArte(modelo, geometria));

  for (const codigo of codigos) {
    adicionarPagina(documento, arte, codigo, modelo, geometria);
  }

  documento.setTitle(titulo);
  documento.setSubject(`Arte para impressão — modelo ${modelo.nome}`);
  documento.setCreator("Sistema de Cartões NFC");
  documento.setProducer("pdf-lib");
  return documento.save();
}

/** Arte individual de um cartão (uma página). */
export function gerarPdfDoCartao(codigo: string, modelo: ModeloDeImpressao): Promise<Uint8Array> {
  return gerarPdfDeImpressao([codigo], modelo, `${modelo.slug}-${codigo}`);
}
