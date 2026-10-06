// Produção com template: PDF individual, PDF do lote, controle.csv e o pacote (ZIP) para a gráfica.
//
// O lote fica preso ao template com que foi criado (lotes.template_id + SHA-256 do arquivo).
// Todas as funções recebem só CÓDIGOS de cartão: a URL do QR vem sempre de getCardPublicUrl().
import type { Lote, TemplateDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { arquivoQrNoLote } from "@/modules/batches/exportacao";
import { codigoValido } from "@/modules/cards/codigo";
import { ROTULO_TIPO } from "@/modules/cards/tipos";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import {
  NOME_DO_CSV_DE_CONTROLE,
  NOME_DO_LEIA_ME,
  montarCsvDeControle,
  nomeDeArquivoSeguro,
  type ItemDeProducao,
} from "@/modules/printing/producao";
import { gerarMatrizDoConteudo, gerarQrSvg } from "@/modules/qr/gerar";
import type { ArmazenamentoDeArquivos } from "@/modules/storage/tipos";
import { formatarDimensoesMm, formatarMm } from "./formato";
import { medidasDoQr } from "./geometria-do-qr";
import { MAXIMO_DE_CARTOES_POR_PDF, prepararTemplate, renderTemplatePdf } from "./renderizacao";
import { SLUG_DO_PRODUTO, buscarTemplate, carregarArquivoDoTemplate, configuracaoDoQr } from "./servico";
import type { ConfiguracaoDoQr } from "./tipos";
import { zipEmFluxo, type EntradaDoZip } from "./zip-em-fluxo";

/**
 * Os PDFs individuais carregam a arte inteira, cada um: 100 cartões com uma arte de 2 MB são 200 MB.
 * Eles entram no ZIP enquanto a soma ficar abaixo deste teto, que existe por causa do tempo de
 * download (a função da Vercel fica aberta até o fim dele), não da memória: o ZIP sai em fluxo.
 * Acima do teto, o pacote sai sem a pasta individuais/ (o PDF do lote tem as mesmas páginas), o
 * LEIA-ME avisa e a página do lote mostra isso antes do download.
 */
export const LIMITE_DOS_PDFS_INDIVIDUAIS_BYTES = 500 * 1024 * 1024;

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("IMPRESSAO_INVALIDA", mensagem);
}

type TemplateDoLote = TemplateDeImpressao & { tipo: NonNullable<TemplateDeImpressao["tipo"]> };

export interface PacoteComTemplate {
  /** Nome-base dos arquivos, ex.: lote-google-2026-001. */
  nome: string;
  identificadorDoLote: string;
  template: TemplateDoLote;
  qr: ConfiguracaoDoQr;
  itens: ItemDeProducao[];
}

/** Ex.: google-K8M4T2.pdf */
export function nomeDoPdfDoCartaoComTemplate(template: Pick<TemplateDoLote, "tipo">, codigo: string): string {
  return nomeDeArquivoSeguro(`${SLUG_DO_PRODUTO[template.tipo]}-${codigo}.pdf`);
}

/** Ex.: lote-google-2026-001 (o número do lote é ano + sequência). */
export function nomeDoPacoteComTemplate(lote: Pick<Lote, "ano" | "sequencia">, template: Pick<TemplateDoLote, "tipo">): string {
  const numero = `${lote.ano}-${String(lote.sequencia).padStart(3, "0")}`;
  return nomeDeArquivoSeguro(`lote-${SLUG_DO_PRODUTO[template.tipo]}-${numero}`);
}

function exigirTemplateUtilizavel(template: TemplateDeImpressao): { template: TemplateDoLote; qr: ConfiguracaoDoQr } {
  const qr = configuracaoDoQr(template);
  if (!template.tipo || !qr) {
    throw falha(`O template “${template.nome}” não tem produto ou área do QR Code definidos.`);
  }
  return { template: { ...template, tipo: template.tipo }, qr };
}

/** Template com que o lote foi gerado, ou null se o lote é anterior aos templates. */
export async function buscarTemplateDoLote(db: Banco, lote: Pick<Lote, "templateId">): Promise<TemplateDeImpressao | null> {
  if (!lote.templateId) return null;
  const template = await buscarTemplate(db, lote.templateId);
  if (!template) throw falha("O template de impressão deste lote não foi encontrado.");
  return template;
}

/**
 * Arquivo do template do lote. O SHA-256 guardado no lote quando ele foi criado precisa ser o do
 * arquivo: é a garantia de que o lote é sempre regerado com exatamente a mesma arte.
 */
export function carregarArquivoDoLote(
  armazenamento: ArmazenamentoDeArquivos,
  lote: Pick<Lote, "templateSha256">,
  template: TemplateDeImpressao,
): Promise<Uint8Array> {
  return carregarArquivoDoTemplate(armazenamento, template, lote.templateSha256 ?? template.sha256);
}

/**
 * Valida tudo ANTES de gerar qualquer arquivo e devolve o plano do pacote do lote.
 * O status do template não importa aqui: um lote antigo continua gerando seus arquivos mesmo
 * que o template tenha sido inativado depois.
 */
export function planejarPacoteComTemplate(
  lote: Pick<Lote, "identificador" | "ano" | "sequencia">,
  codigos: readonly string[],
  templateDoLote: TemplateDeImpressao,
): PacoteComTemplate {
  const { template, qr } = exigirTemplateUtilizavel(templateDoLote);

  if (codigos.length === 0) throw falha("Este lote não tem cartões.");
  if (codigos.length > MAXIMO_DE_CARTOES_POR_PDF) {
    throw falha(`Um PDF pode ter no máximo ${MAXIMO_DE_CARTOES_POR_PDF} cartões (este lote tem ${codigos.length}).`);
  }
  const invalido = codigos.find((codigo) => !codigoValido(codigo));
  if (invalido !== undefined) {
    throw falha(`O lote contém um cartão com código inválido (${String(invalido).slice(0, 12)}).`);
  }
  if (new Set(codigos).size !== codigos.length) {
    throw falha("O lote contém o mesmo código mais de uma vez.");
  }

  return {
    nome: nomeDoPacoteComTemplate(lote, template),
    identificadorDoLote: lote.identificador,
    template,
    qr,
    itens: codigos.map((codigo, indice) => ({
      numero: indice + 1,
      codigo,
      url: getCardPublicUrl(codigo),
      arquivoPdf: nomeDoPdfDoCartaoComTemplate(template, codigo),
      arquivoQr: nomeDeArquivoSeguro(arquivoQrNoLote(codigo)),
    })),
  };
}

/** PDF individual: a página do template com o QR do cartão. */
export function gerarPdfDoCartaoComTemplate(
  arquivoDoTemplate: Uint8Array,
  templateDoLote: TemplateDeImpressao,
  codigo: string,
): Promise<Uint8Array> {
  const { qr } = exigirTemplateUtilizavel(templateDoLote);
  return renderTemplatePdf(arquivoDoTemplate, qr, [getCardPublicUrl(codigo)]);
}

/** PDF do lote: uma página por cartão, na ordem do controle.csv. Nada é imposto em folha. */
export function gerarPdfDoPacoteComTemplate(pacote: PacoteComTemplate, arquivoDoTemplate: Uint8Array): Promise<Uint8Array> {
  return renderTemplatePdf(
    arquivoDoTemplate,
    pacote.qr,
    pacote.itens.map((item) => getCardPublicUrl(item.codigo)),
  );
}

/** Controle do lote, com a coluna `template`. */
export function gerarCsvDeControleComTemplate(pacote: PacoteComTemplate): string {
  return montarCsvDeControle({ itens: pacote.itens, tipo: pacote.template.tipo, template: pacote.template.nome });
}

export function gerarLeiaMeComTemplate(pacote: PacoteComTemplate, comIndividuais: boolean): string {
  const { template, itens } = pacote;
  const qr = medidasDoQr(pacote.qr, gerarMatrizDoConteudo(itens[0].url).lado);
  return [
    `PACOTE DE PRODUÇÃO — ${pacote.nome}`,
    "",
    `Lote: ${pacote.identificadorDoLote}`,
    `Produto: ${ROTULO_TIPO[template.tipo]}`,
    `Template usado: ${template.nome}`,
    `Arquivo da arte: ${template.arquivoNomeOriginal} (SHA-256 ${template.sha256})`,
    `Cartões neste pacote: ${itens.length}`,
    "",
    "ARQUIVOS",
    `  ${pacote.nome}.pdf   uma página por cartão, na ordem do ${NOME_DO_CSV_DE_CONTROLE}`,
    `  ${NOME_DO_CSV_DE_CONTROLE}   número, código, template e URL de cada cartão`,
    comIndividuais
      ? "  individuais/   um PDF por cartão (mesma página do PDF do lote)"
      : "  (sem PDFs individuais: a arte é pesada e eles deixariam o pacote grande demais; use o PDF do lote)",
    "  qr/            QR Code avulso de cada cartão em SVG vetorial",
    "",
    "ESPECIFICAÇÕES DE IMPRESSÃO",
    `  Página: ${formatarDimensoesMm(template.larguraDaPaginaMm, template.alturaDaPaginaMm)}, igual à do arquivo da arte.`,
    "  Cada página é a arte original, sem nenhuma alteração, mais o QR Code do cartão.",
    "  As caixas da página (MediaBox, CropBox, TrimBox, BleedBox) são as do arquivo da arte.",
    "  Uma página por cartão: a imposição em folha é feita pela gráfica.",
    `  QR Code vetorial, preto puro (K 100%) sobre branco, com ${formatarMm(qr.ladoMm)} mm de lado`,
    `  (${formatarMm(qr.ladoComMargemMm)} mm com a margem de silêncio) e módulos de ${formatarMm(qr.moduloMm)} mm.`,
    "  Não redimensionar, girar ou sobrepor nada ao QR Code. Imprimir em 100% (sem ajustar à página).",
    "  O sistema preserva o PDF-base e adiciona o QR. A preparação profissional de CMYK, perfil ICC",
    "  e PDF/X deve ser feita no arquivo-base quando exigida pela gráfica.",
    "",
    "CADA CARTÃO É ÚNICO",
    `  Cada página tem um QR Code diferente. A página N do PDF é o cartão de número N do ${NOME_DO_CSV_DE_CONTROLE}.`,
    "",
    "GRAVAÇÃO DO NFC",
    `  Grave no chip de cada cartão a URL da coluna url_nfc do ${NOME_DO_CSV_DE_CONTROLE}.`,
    "  É a mesma URL do QR Code daquele cartão (coluna url_qr). Leia o QR do cartão para conferir",
    "  o código antes de gravar, para não trocar o chip de um cartão com o de outro.",
    "",
  ].join("\r\n");
}

/** Os PDFs individuais cabem no pacote? Cada um pesa o template mais cerca de 1 KB. */
export function individuaisCabemNoPacote(quantidade: number, tamanhoDoTemplateBytes: number): boolean {
  return quantidade * (tamanhoDoTemplateBytes + 2048) <= LIMITE_DOS_PDFS_INDIVIDUAIS_BYTES;
}

/**
 * ZIP para a gráfica: PDF do lote, controle.csv, LEIA-ME, os PDFs individuais (se couberem no
 * limite) e os QR Codes em SVG.
 *
 * O ZIP sai em FLUXO: cada PDF individual é gerado, enviado e descartado, então a memória usada não
 * cresce com o tamanho do lote. Tudo o que pode dar errado (abrir o template, conferir a área do QR,
 * gerar o PDF do lote) acontece ANTES de o fluxo ser devolvido — depois que o download começa, só
 * resta repetir a mesma operação para cada cartão.
 */
export async function gerarZipComTemplate(
  pacote: PacoteComTemplate,
  arquivoDoTemplate: Uint8Array,
): Promise<ReadableStream<Uint8Array>> {
  const comIndividuais = individuaisCabemNoPacote(pacote.itens.length, arquivoDoTemplate.length);
  // PDFs com imagens já são comprimidos por dentro: recomprimir uma arte pesada só gastaria tempo.
  const comprimirPdf = arquivoDoTemplate.length <= 1024 * 1024;
  const urlDoCartao = (item: ItemDeProducao) => getCardPublicUrl(item.codigo);

  // O template é aberto uma única vez, para o PDF do lote e para todos os individuais.
  const template = await prepararTemplate(arquivoDoTemplate, pacote.qr);
  const pdfDoLote = await template.renderizar(pacote.itens.map(urlDoCartao));

  async function* arquivos(): AsyncGenerator<EntradaDoZip> {
    const pasta = pacote.nome;
    yield { nome: `${pasta}/${pasta}.pdf`, dados: pdfDoLote, comprimir: comprimirPdf };
    yield { nome: `${pasta}/${NOME_DO_CSV_DE_CONTROLE}`, dados: gerarCsvDeControleComTemplate(pacote), comprimir: true };
    yield { nome: `${pasta}/${NOME_DO_LEIA_ME}`, dados: gerarLeiaMeComTemplate(pacote, comIndividuais), comprimir: true };
    if (comIndividuais) {
      for (const item of pacote.itens) {
        yield {
          nome: `${pasta}/individuais/${item.arquivoPdf}`,
          dados: await template.renderizar([urlDoCartao(item)]),
          comprimir: comprimirPdf,
        };
      }
    }
    for (const item of pacote.itens) {
      yield { nome: `${pasta}/qr/${item.arquivoQr}`, dados: await gerarQrSvg(item.codigo), comprimir: true };
    }
  }
  return zipEmFluxo(arquivos());
}
