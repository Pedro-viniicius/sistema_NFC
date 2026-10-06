// Arte final de impressão:  ARTE FIXA do modelo  +  QR Code do cartão  =  PDF pronto para a gráfica.
//
// As funções recebem apenas CÓDIGOS de cartão. O gerador não conhece o destino configurado:
// o QR é sempre a URL permanente, obtida pelo módulo de QR a partir de getCardPublicUrl().
import { PDFDocument, cmyk, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";
import { ErroDeDominio } from "@/lib/erros";
import { gerarMatrizDoQr, type MatrizDoQr } from "@/modules/qr/gerar";
import { GLIFOS_DO_CODIGO, carregarArteDoModelo, descricaoDaArte } from "./arquivos-do-modelo";
import { desenharQr } from "./desenho-do-qr";
import { salvarSemObjetosOrfaos } from "./limpeza-do-pdf";
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

export interface ArteAberta {
  pagina: PDFPage;
  /** Falso quando a arte veio no tamanho final (sem sangria): ela é posicionada dentro do corte. */
  comSangria: boolean;
}

function mesmoTamanho(largura: number, altura: number, esperado: { largura: number; altura: number }): boolean {
  return (
    Math.abs(largura - esperado.largura) <= TOLERANCIA_PT && Math.abs(altura - esperado.altura) <= TOLERANCIA_PT
  );
}

/**
 * Abre a arte fixa e confere o tamanho. A arte NUNCA é redimensionada: precisa ter exatamente o
 * tamanho da arte completa (com sangria) ou o tamanho final (sem sangria).
 */
async function abrirArte(modelo: ModeloDeImpressao, geometria: GeometriaDoModelo): Promise<ArteAberta> {
  const descricao = descricaoDaArte(modelo);
  const bytes = await carregarArteDoModelo(modelo);

  // A biblioteca tolera arquivos danificados ao abrir e só falha ao ler as páginas:
  // por isso toda a leitura fica protegida, e qualquer falha vira uma mensagem clara.
  let paginas: number;
  let pagina: PDFPage;
  let width: number;
  let height: number;
  try {
    const arte = await PDFDocument.load(bytes);
    paginas = arte.getPageCount();
    pagina = arte.getPage(0);
    ({ width, height } = pagina.getSize());
  } catch {
    throw falha(`O arquivo da ${descricao} não é um PDF válido (ou está protegido por senha).`);
  }
  if (paginas !== 1) {
    throw falha(`A ${descricao} deve ter exatamente uma página (tem ${paginas}).`);
  }

  if (mesmoTamanho(width, height, { largura: geometria.larguraPt, altura: geometria.alturaPt })) {
    return { pagina, comSangria: true };
  }
  if (mesmoTamanho(width, height, geometria.corte)) {
    return { pagina, comSangria: false };
  }
  throw falha(
    `A ${descricao} mede ${emMm(width)} × ${emMm(height)} mm. O modelo ${modelo.nome} aceita ` +
      `${emMm(geometria.larguraPt)} × ${emMm(geometria.alturaPt)} mm (com sangria) ou ` +
      `${emMm(geometria.corte.largura)} × ${emMm(geometria.corte.altura)} mm (sem sangria).`,
  );
}

/**
 * Confere, sem gerar nada, se a arte do modelo existe, é um PDF de uma página e tem um tamanho aceito.
 * Informa se a arte tem sangria.
 */
export async function verificarArteDoModelo(modelo: ModeloDeImpressao): Promise<{ comSangria: boolean }> {
  const { comSangria } = await abrirArte(modelo, geometriaDoModelo(modelo));
  return { comSangria };
}

/** Confere se o QR do cartão cabe na área do modelo com módulos de tamanho legível. */
export function verificarQrDoCartao(codigo: string, modelo: ModeloDeImpressao): MatrizDoQr {
  const matriz = gerarMatrizDoQr(codigo);
  if (tamanhoDoModuloMm(modelo, matriz) < MODULO_MINIMO_MM) {
    throw falha(
      `O QR Code do cartão ${codigo} ficaria com módulos menores que ${MODULO_MINIMO_MM} mm ` +
        `na área de ${modelo.qr.tamanhoMm} mm do modelo ${modelo.nome}. Aumente a área do QR ou use um domínio mais curto.`,
    );
  }
  return matriz;
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
  arteComSangria: boolean,
  codigo: string,
  modelo: ModeloDeImpressao,
  geometria: GeometriaDoModelo,
): void {
  const matriz = verificarQrDoCartao(codigo, modelo);

  const pagina = documento.addPage([geometria.larguraPt, geometria.alturaPt]);
  const { corte } = geometria;
  pagina.setBleedBox(0, 0, geometria.larguraPt, geometria.alturaPt);
  pagina.setTrimBox(corte.x, corte.y, corte.largura, corte.altura);

  // 1) arte fixa, em tamanho real; 2) QR do cartão; 3) código do cartão.
  // Arte sem sangria entra exatamente dentro do corte; a faixa de sangria fica sem impressão.
  const areaDaArte = arteComSangria
    ? { x: 0, y: 0, width: geometria.larguraPt, height: geometria.alturaPt }
    : { x: corte.x, y: corte.y, width: corte.largura, height: corte.altura };
  pagina.drawPage(arte, areaDaArte);
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
  const aberta = await abrirArte(modelo, geometria);
  const arte = await documento.embedPage(aberta.pagina);

  for (const codigo of codigos) {
    adicionarPagina(documento, arte, aberta.comSangria, codigo, modelo, geometria);
  }

  documento.setTitle(titulo);
  documento.setSubject(`Arte para impressão — modelo ${modelo.nome}`);
  documento.setCreator("Sistema de Cartões NFC");
  documento.setProducer("pdf-lib");
  return salvarSemObjetosOrfaos(documento);
}

/** Arte individual de um cartão (uma página). */
export function gerarPdfDoCartao(codigo: string, modelo: ModeloDeImpressao): Promise<Uint8Array> {
  return gerarPdfDeImpressao([codigo], modelo, `${modelo.slug}-${codigo}`);
}
