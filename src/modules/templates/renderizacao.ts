// Núcleo da impressão com template:
//
//     PDF DO TEMPLATE (arte final enviada)  +  QR ÚNICO (URL permanente do cartão)  =  PDF DE PRODUÇÃO
//
// Um único serviço atende a prévia de teste, o PDF individual e o PDF do lote. A arte nunca é
// recriada, redimensionada, recolorida, recomprimida nem rasterizada: cada página de saída é a
// própria página do template (mesmos objetos, mesmas caixas), com um trecho a mais de conteúdo que
// desenha o QR. O template nunca decide o que vai no QR: quem decide é o cartão.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPageLeaf,
  PDFPageTree,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { ErroDeDominio } from "@/lib/erros";
import { salvarSemObjetosOrfaos } from "@/modules/printing/limpeza-do-pdf";
import { agruparEmBlocos, gerarMatrizDoConteudo, type MatrizDoQr } from "@/modules/qr/gerar";
import { caixaVisivel, validateQrArea } from "./coordenadas";
import { analisarEstadoGrafico } from "./estado-grafico";
import { quadradoDoQr } from "./geometria-do-qr";
import { ZONA_DE_SILENCIO_MAXIMA, ZONA_DE_SILENCIO_MINIMA, type CaixaPt, type ConfiguracaoDoQr } from "./tipos";
import { lerCaixaDaPagina } from "./validacao-do-pdf";

/**
 * Máximo de páginas (cartões) em um único PDF. É também o tamanho máximo de um lote.
 * Medido com um template de 25 MB: 1.000 páginas levam cerca de 1 s e o arquivo cresce
 * cerca de 1 KB por página (ver docs/templates-impressao.md).
 */
export const MAXIMO_DE_CARTOES_POR_PDF = 1000;

/** Marca o trecho do QR no conteúdo da página, o que permite localizá-lo e conferi-lo depois. */
export const MARCA_DO_QR = "QRCode";

/**
 * Formato de uma URL permanente de cartão: origem + /c/ + código. O gerador recusa qualquer outra
 * coisa — em especial o destino do cartão (Instagram, Google etc.), que nunca vai para o QR.
 */
const FORMATO_DA_URL_PERMANENTE = /^https?:\/\/[^\s/?#]+\/c\/[A-Z0-9]{4,16}$/;

/** Entradas da página original que não fazem sentido em uma cópia. */
const ENTRADAS_NAO_COPIADAS = new Set(["Parent", "Contents", "Annots", "StructParents", "B", "Tabs"]);
/** Atributos que uma página pode herdar da árvore de páginas: nas cópias ficam explícitos. */
const ATRIBUTOS_HERDAVEIS = ["Resources", "MediaBox", "CropBox", "Rotate"];

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("TEMPLATE_INVALIDO", mensagem);
}

/** Número com até 4 casas decimais (0,0001 pt ≈ 35 nanômetros), sem zeros à direita. */
function n(valor: number): string {
  const texto = valor.toFixed(4).replace(/\.?0+$/, "");
  return texto === "-0" ? "0" : texto;
}

function paginaUnica(documento: PDFDocument): PDFPageLeaf {
  const paginas: PDFPageLeaf[] = [];
  documento.catalog.Pages().traverse((no) => {
    if (no instanceof PDFPageLeaf) paginas.push(no);
  });
  if (paginas.length !== 1) throw falha("O template deve possuir apenas uma página.");
  return paginas[0];
}

/** Referências dos fluxos de conteúdo originais, na ordem em que são desenhados. */
function conteudoOriginal(contexto: PDFContext, pagina: PDFPageLeaf): PDFRef[] {
  const valor = pagina.get(PDFName.of("Contents"));
  if (valor === undefined) return [];
  const resolvido = contexto.lookup(valor);
  if (resolvido instanceof PDFArray) {
    return resolvido.asArray().filter((item): item is PDFRef => item instanceof PDFRef);
  }
  return valor instanceof PDFRef ? [valor] : [];
}

/** Quantos estados gráficos a arte abre e fecha. Se não der para ler, considera a arte equilibrada. */
function estadoGraficoDaArte(contexto: PDFContext, fluxos: PDFRef[]): { minimo: number; final: number } {
  try {
    const partes = fluxos.map((referencia) => {
      const fluxo = contexto.lookup(referencia);
      return fluxo instanceof PDFRawStream ? decodePDFRawStream(fluxo).decode() : new Uint8Array();
    });
    const total = partes.reduce((soma, parte) => soma + parte.length + 1, 0);
    const junto = new Uint8Array(total).fill(0x0a);
    let posicao = 0;
    for (const parte of partes) {
      junto.set(parte, posicao);
      posicao += parte.length + 1;
    }
    return analisarEstadoGrafico(junto);
  } catch {
    return { minimo: 0, final: 0 };
  }
}

/**
 * Operadores que desenham o QR, em um estado gráfico limpo:
 *  - fundo branco (sem tinta) só no quadrado do QR, zona de silêncio incluída;
 *  - módulos em 100% K (DeviceCMYK 0 0 0 1): preto puro, sem mistura de cores e sem problema de registro;
 *  - TODOS os módulos em um único caminho preenchido de uma vez, com os vizinhos já unidos em blocos.
 *    Os blocos são escritos em coordenadas INTEIRAS de módulo (uma matriz leva a grade para o lugar
 *    certo na página), então as arestas compartilhadas são exatamente as mesmas. Não há contornos
 *    (traços): não aparecem emendas finas entre módulos em nenhum visualizador ou RIP.
 */
function operadoresDoQr(matriz: MatrizDoQr, config: ConfiguracaoDoQr): string {
  const quadrado = quadradoDoQr(config, matriz.lado);
  const zona = config.zonaDeSilencioModulos;
  const esquerda = quadrado.x + zona * quadrado.modulo;
  const topo = quadrado.y + quadrado.lado - zona * quadrado.modulo;
  const modulo = quadrado.modulo.toFixed(6);

  return [
    `/${MARCA_DO_QR} BMC`,
    "q",
    "0 0 0 0 k",
    `${n(quadrado.x)} ${n(quadrado.y)} ${n(quadrado.lado)} ${n(quadrado.lado)} re`,
    "f",
    "0 0 0 1 k",
    // Grade de módulos: 1 unidade = 1 módulo, origem no canto superior esquerdo do QR, y para baixo.
    `${modulo} 0 0 -${modulo} ${n(esquerda)} ${n(topo)} cm`,
    ...agruparEmBlocos(matriz).map((bloco) => `${bloco.coluna} ${bloco.linha} ${bloco.largura} ${bloco.altura} re`),
    "f",
    "Q",
    "EMC",
  ].join("\n");
}

function conferirUrls(urls: readonly string[]): void {
  if (urls.length === 0) throw falha("Não há cartões para gerar o PDF.");
  if (urls.length > MAXIMO_DE_CARTOES_POR_PDF) {
    throw falha(
      `Um PDF pode ter no máximo ${MAXIMO_DE_CARTOES_POR_PDF} cartões (foram pedidos ${urls.length}). Divida o lote.`,
    );
  }
  const invalida = urls.find((url) => typeof url !== "string" || !FORMATO_DA_URL_PERMANENTE.test(url));
  if (invalida !== undefined) {
    throw falha("O QR Code de um template só pode conter a URL permanente de um cartão.");
  }
}

function conferirConfiguracao(qrConfig: ConfiguracaoDoQr): void {
  const zona = qrConfig.zonaDeSilencioModulos;
  if (!Number.isInteger(zona) || zona < ZONA_DE_SILENCIO_MINIMA || zona > ZONA_DE_SILENCIO_MAXIMA) {
    throw falha(
      `A zona de silêncio do QR Code deve ter de ${ZONA_DE_SILENCIO_MINIMA} a ${ZONA_DE_SILENCIO_MAXIMA} módulos.`,
    );
  }
}

export interface TemplatePreparado {
  /**
   * Gera um PDF com uma página por URL, na ordem recebida. Pode ser chamado várias vezes (uma de
   * cada vez): o template é lido e analisado uma única vez, o que importa ao gerar muitos PDFs
   * individuais seguidos.
   */
  renderizar(urls: readonly string[]): Promise<Uint8Array>;
}

/**
 * Abre o template uma vez e prepara tudo o que é comum a todas as páginas de saída.
 * O resultado de `renderizar` é sempre o mesmo para as mesmas URLs, não importa quantas vezes
 * ou em que ordem o template preparado já foi usado.
 */
export async function prepararTemplate(
  templateBytes: Uint8Array,
  qrConfig: ConfiguracaoDoQr,
): Promise<TemplatePreparado> {
  conferirConfiguracao(qrConfig);

  let documento: PDFDocument;
  try {
    // `updateMetadata: false`: os metadados do arquivo original não são tocados.
    documento = await PDFDocument.load(templateBytes, { updateMetadata: false });
  } catch {
    throw falha("O arquivo do template não pôde ser aberto.");
  }
  const contexto = documento.context;
  const original = paginaUnica(documento);

  const mediaBox = lerCaixaDaPagina(contexto, original.getInheritableAttribute(PDFName.of("MediaBox")));
  if (!mediaBox) throw falha("O template não informa o tamanho da página.");
  const cropBox: CaixaPt =
    lerCaixaDaPagina(contexto, original.getInheritableAttribute(PDFName.of("CropBox"))) ?? mediaBox;
  const problemas = validateQrArea(qrConfig.area, caixaVisivel(mediaBox, cropBox));
  if (problemas.length > 0) throw falha(problemas.join(" "));

  // Entradas comuns a todas as cópias. Objetos grandes viram referências, para não se repetirem.
  const entradas = new Map<PDFName, PDFObject>();
  for (const [nome, valor] of original.entries()) {
    if (!ENTRADAS_NAO_COPIADAS.has(nome.decodeText())) entradas.set(nome, valor);
  }
  for (const atributo of ATRIBUTOS_HERDAVEIS) {
    const nome = PDFName.of(atributo);
    const valor = original.getInheritableAttribute(nome);
    if (valor !== undefined) entradas.set(nome, valor);
  }
  const recursos = entradas.get(PDFName.of("Resources"));
  if (recursos instanceof PDFDict) entradas.set(PDFName.of("Resources"), contexto.register(recursos));

  const arte = conteudoOriginal(contexto, original);
  const estado = estadoGraficoDaArte(contexto, arte);
  // Abre níveis suficientes para a arte nunca alcançar o estado inicial da página…
  const abertos = 1 + Math.max(0, -estado.minimo);
  // …e depois fecha tudo o que ficou aberto, voltando exatamente ao estado inicial.
  const aFechar = abertos + estado.final;
  const abertura = contexto.register(contexto.stream(`${Array(abertos).fill("q").join(" ")}\n`));
  const fechamento = `\n${Array(aFechar).fill("Q").join(" ")}\n`;

  // A árvore de páginas original (com a página sem QR) é trocada por uma nova, plana.
  const arvore = PDFPageTree.withContext(contexto);
  const referenciaDaArvore = contexto.register(arvore);
  documento.catalog.set(PDFName.of("Pages"), referenciaDaArvore);

  // Cada geração numera seus objetos a partir daqui; os da geração anterior são descartados ao salvar.
  const numeracaoBase = contexto.largestObjectNumber;
  let emUso = false;

  return {
    async renderizar(urls) {
      conferirUrls(urls);
      if (emUso) throw new Error("O template preparado já está gerando outro PDF.");
      emUso = true;
      try {
        contexto.largestObjectNumber = numeracaoBase;
        const paginas: PDFRef[] = [];
        for (const url of urls) {
          const qr = contexto.register(
            contexto.flateStream(fechamento + operadoresDoQr(gerarMatrizDoConteudo(url), qrConfig) + "\n"),
          );
          const mapa = new Map(entradas);
          mapa.set(PDFName.of("Type"), PDFName.of("Page"));
          mapa.set(PDFName.of("Parent"), referenciaDaArvore);
          mapa.set(PDFName.of("Contents"), contexto.obj([abertura, ...arte, qr]));
          // `false`: a pdf-lib não deve "normalizar" a página (isso alteraria recursos e conteúdo).
          paginas.push(contexto.register(PDFPageLeaf.fromMapWithContext(mapa, contexto, false)));
        }
        arvore.set(PDFName.of("Kids"), contexto.obj(paginas));
        arvore.set(PDFName.of("Count"), contexto.obj(paginas.length));

        // Tudo o que não é alcançável a partir da raiz (a página original, sem QR, e as páginas de
        // uma geração anterior) é descartado. Tabela de referências clássica, sem fluxos de objetos:
        // é o formato mais aceito por RIPs de gráfica.
        return await salvarSemObjetosOrfaos(documento, {
          useObjectStreams: false,
          addDefaultPage: false,
          updateFieldAppearances: false,
        });
      } finally {
        emUso = false;
      }
    },
  };
}

/**
 * Gera o PDF de produção: uma página por URL, na ordem recebida. Cada página é uma cópia da página
 * do template com o QR daquela URL dentro da área configurada.
 *
 * - As caixas (MediaBox, CropBox, TrimBox, BleedBox), a orientação e o conteúdo original são os do
 *   template. Os fluxos de conteúdo, as imagens e as fontes da arte são COMPARTILHADOS por todas
 *   as páginas: o arquivo pesa o template mais cerca de 1 KB por página.
 * - A arte é isolada com q/Q (inclusive quando ela mesma deixa estados gráficos abertos), para que
 *   uma transformação ou um recorte "esquecido" na arte não desloque nem corte o QR.
 */
export async function renderTemplatePdf(
  templateBytes: Uint8Array,
  qrConfig: ConfiguracaoDoQr,
  urls: readonly string[],
): Promise<Uint8Array> {
  conferirUrls(urls);
  return (await prepararTemplate(templateBytes, qrConfig)).renderizar(urls);
}
