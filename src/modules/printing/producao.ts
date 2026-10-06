// Pacote de produção de um lote: tudo o que a gráfica (e quem grava os chips NFC) precisa.
//
//   lote-2026-001-google/
//     lote-2026-001-google.pdf     uma página por cartão
//     controle.csv                 número, código e a URL permanente (QR = NFC) de cada cartão
//     LEIA-ME.txt                  especificações para a gráfica e para a gravação do NFC
//     individuais/google-K8M4T2.pdf
//     qr/K8M4T2.svg
//
// Tudo é gerado em memória a partir do banco e devolvido como download; nada vai para disco.
import JSZip from "jszip";
import { ErroDeDominio } from "@/lib/erros";
import { arquivoQrNoLote } from "@/modules/batches/exportacao";
import { codigoValido } from "@/modules/cards/codigo";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { conteudoDoQr, gerarQrSvg } from "@/modules/qr/gerar";
import { obterModelo, obterModeloPorSlug, validarModelo, type ModeloDeImpressao } from "./modelos";
import { gerarPdfDeImpressao, gerarPdfDoCartao, verificarArteDoModelo, verificarQrDoCartao } from "./pdf";

/**
 * Limite de cartões por pacote, definido por medição (Node 22, arte-base de 8 KB): cada cartão ocupa
 * cerca de 15 KB no ZIP, então 100 cartões dão 1,5 MB em 0,7 s — cerca de 3× de folga em relação ao
 * teto de 4,5 MB por resposta das funções da Vercel. Lotes maiores são divididos em partes.
 * Artes enviadas mais pesadas são tratadas por LIMITE_DO_ZIP_BYTES, logo abaixo.
 */
export const MAXIMO_DE_CARTOES_POR_PACOTE = 100;

/**
 * Tamanho máximo que o ZIP pode atingir, com folga em relação ao teto de 4,5 MB da Vercel.
 * Cada PDF individual carrega a arte inteira; com uma arte pesada, 100 deles não cabem.
 * Nesse caso o ZIP sai sem a pasta individuais/ (o PDF do lote tem as mesmas páginas).
 */
export const LIMITE_DO_ZIP_BYTES = 3.5 * 1024 * 1024;

const FORMATO_DO_IDENTIFICADOR_DO_LOTE = /^lote-\d{4}-\d{3,}$/;
const NOME_DE_ARQUIVO_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const NOME_DO_CSV_DE_CONTROLE = "controle.csv";
export const NOME_DO_LEIA_ME = "LEIA-ME.txt";
export const COLUNAS_DO_CONTROLE = [
  "numero",
  "codigo",
  "tipo",
  "url_permanente",
  "url_nfc",
  "url_qr",
  "arquivo_pdf",
  "arquivo_qr",
] as const;

/** Nos lotes gerados com um template de impressão, o controle traz também o nome do template. */
export const COLUNAS_DO_CONTROLE_COM_TEMPLATE = [
  ...COLUNAS_DO_CONTROLE.slice(0, 3),
  "template",
  ...COLUNAS_DO_CONTROLE.slice(3),
] as const;

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("IMPRESSAO_INVALIDA", mensagem);
}

/** Garante que um nome usado em arquivo/cabeçalho HTTP só tem caracteres seguros. */
export function nomeDeArquivoSeguro(nome: string): string {
  if (!NOME_DE_ARQUIVO_SEGURO.test(nome)) throw falha("Nome de arquivo inválido.");
  return nome;
}

/** Nome do PDF individual, ex.: google-K8M4T2.pdf. */
export function nomeDoPdfDoCartao(modelo: ModeloDeImpressao, codigo: string): string {
  return nomeDeArquivoSeguro(`${modelo.slug}-${codigo}.pdf`);
}

/** Primeiro dos tipos informados que tem arte de impressão, ou null. */
export function sugerirModelo(...tipos: Parameters<typeof obterModelo>[0][]): ModeloDeImpressao | null {
  for (const tipo of tipos) {
    const modelo = obterModelo(tipo);
    if (modelo) return modelo;
  }
  return null;
}

/**
 * Escolhe o modelo de impressão: o pedido explicitamente (slug) ou, na falta dele,
 * o primeiro tipo informado que tenha arte (ex.: tipo do lote, depois tipo do cartão).
 */
export function escolherModelo(
  slugPedido: string | null | undefined,
  ...tipos: Parameters<typeof obterModelo>[0][]
): ModeloDeImpressao {
  if (slugPedido) {
    const pedido = obterModeloPorSlug(slugPedido);
    if (!pedido) throw new ErroDeDominio("MODELO_NAO_ENCONTRADO", "Modelo de impressão desconhecido.");
    return pedido;
  }
  const sugerido = sugerirModelo(...tipos);
  if (sugerido) return sugerido;
  throw new ErroDeDominio(
    "MODELO_NAO_ENCONTRADO",
    "Este item não tem um modelo de impressão definido. Escolha o modelo (Google ou Instagram).",
  );
}

export function totalDePartes(quantidadeDeCartoes: number): number {
  return Math.max(Math.ceil(quantidadeDeCartoes / MAXIMO_DE_CARTOES_POR_PACOTE), 1);
}

export interface ItemDeProducao {
  /** Posição do cartão no lote (1, 2, 3…), contínua entre as partes. É a página no PDF da parte 1. */
  numero: number;
  codigo: string;
  /** URL permanente: é a mesma no QR Code e no chip NFC. */
  url: string;
  arquivoPdf: string;
  arquivoQr: string;
}

export interface PacoteDeProducao {
  /** Nome-base dos arquivos, ex.: lote-2026-001-google ou lote-2026-001-google-parte-02. */
  nome: string;
  identificadorDoLote: string;
  modelo: ModeloDeImpressao;
  parte: number;
  totalDePartes: number;
  totalDeCartoesDoLote: number;
  itens: ItemDeProducao[];
}

export interface PedidoDeProducao {
  identificadorDoLote: string;
  /** Códigos de TODOS os cartões do lote, na ordem de produção. Só os códigos: o destino não entra aqui. */
  codigos: readonly string[];
  modelo: ModeloDeImpressao;
  /** Parte desejada (1 em diante). Padrão: 1. */
  parte?: number;
}

/**
 * Valida tudo ANTES de gerar qualquer arquivo e devolve o plano do pacote.
 * Se algo estiver errado, falha com uma mensagem clara: não existe pacote "pela metade".
 */
export async function planejarPacote(pedido: PedidoDeProducao): Promise<PacoteDeProducao> {
  const { identificadorDoLote, codigos, modelo } = pedido;

  if (!FORMATO_DO_IDENTIFICADOR_DO_LOTE.test(identificadorDoLote)) {
    throw falha("Identificador de lote inválido.");
  }
  if (codigos.length === 0) {
    throw falha("Este lote não tem cartões.");
  }

  const invalido = codigos.find((codigo) => !codigoValido(codigo));
  if (invalido !== undefined) {
    throw falha(`O lote contém um cartão com código inválido (${String(invalido).slice(0, 12)}).`);
  }
  const repetido = codigos.find((codigo, indice) => codigos.indexOf(codigo) !== indice);
  if (repetido) {
    throw falha(`O lote contém o código ${repetido} mais de uma vez.`);
  }

  const problemas = validarModelo(modelo);
  if (problemas.length > 0) throw falha(problemas.join(" "));
  await verificarArteDoModelo(modelo);

  const partes = totalDePartes(codigos.length);
  const parte = pedido.parte ?? 1;
  if (!Number.isInteger(parte) || parte < 1 || parte > partes) {
    throw falha(
      partes === 1
        ? "Este lote tem apenas um pacote (parte 1)."
        : `Parte inválida: este lote tem ${partes} partes de até ${MAXIMO_DE_CARTOES_POR_PACOTE} cartões.`,
    );
  }

  const inicio = (parte - 1) * MAXIMO_DE_CARTOES_POR_PACOTE;
  const itens = codigos.slice(inicio, inicio + MAXIMO_DE_CARTOES_POR_PACOTE).map((codigo, indice) => {
    let url: string;
    try {
      url = getCardPublicUrl(codigo);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : "erro desconhecido";
      throw falha(`Não foi possível montar a URL permanente do cartão ${codigo}: ${motivo}`);
    }
    verificarQrDoCartao(codigo, modelo);
    return {
      numero: inicio + indice + 1,
      codigo,
      url,
      arquivoPdf: nomeDoPdfDoCartao(modelo, codigo),
      arquivoQr: nomeDeArquivoSeguro(arquivoQrNoLote(codigo)),
    };
  });

  const sufixoDaParte = partes > 1 ? `-parte-${String(parte).padStart(2, "0")}` : "";
  return {
    nome: nomeDeArquivoSeguro(`${identificadorDoLote}-${modelo.slug}${sufixoDaParte}`),
    identificadorDoLote,
    modelo,
    parte,
    totalDePartes: partes,
    totalDeCartoesDoLote: codigos.length,
    itens,
  };
}

function exigirLimite(pacote: PacoteDeProducao): void {
  if (pacote.itens.length === 0 || pacote.itens.length > MAXIMO_DE_CARTOES_POR_PACOTE) {
    throw falha(`Um pacote de produção deve ter de 1 a ${MAXIMO_DE_CARTOES_POR_PACOTE} cartões.`);
  }
}

/** PDF consolidado: uma página por cartão, na ordem do controle.csv. */
export async function gerarPdfDoPacote(pacote: PacoteDeProducao): Promise<Uint8Array> {
  exigirLimite(pacote);
  return gerarPdfDeImpressao(
    pacote.itens.map((item) => item.codigo),
    pacote.modelo,
    pacote.nome,
  );
}

/**
 * Escapa um valor de texto livre para o CSV: aspas quando há vírgula, aspas ou quebra de linha, e
 * um apóstrofo antes de valores que uma planilha interpretaria como fórmula.
 */
function campoDeTexto(valor: string): string {
  const semFormula = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[",\r\n]/.test(semFormula) ? `"${semFormula.replaceAll('"', '""')}"` : semFormula;
}

export interface DadosDoControle {
  itens: readonly ItemDeProducao[];
  /** Produto dos cartões (GOOGLE, INSTAGRAM…). */
  tipo: string;
  /** Nome do template de impressão do lote. Ausente nos lotes sem template: a coluna não é incluída. */
  template?: string;
}

/**
 * Planilha de controle (UTF-8, separada por vírgulas). `url_nfc` e `url_qr` existem para deixar
 * explícito que o chip e o QR de cada cartão recebem a MESMA URL: as duas colunas saem da mesma
 * função canônica (a do QR passa pelo próprio módulo que desenha o QR).
 * Só o nome do template é texto livre, e por isso é o único valor escapado.
 */
export function montarCsvDeControle({ itens, tipo, template }: DadosDoControle): string {
  const comTemplate = template !== undefined;
  const linhas = itens.map((item) =>
    [
      item.numero,
      item.codigo,
      tipo,
      ...(comTemplate ? [campoDeTexto(template)] : []),
      item.url,
      getCardPublicUrl(item.codigo),
      conteudoDoQr(item.codigo),
      item.arquivoPdf,
      item.arquivoQr,
    ].join(","),
  );
  const colunas = comTemplate ? COLUNAS_DO_CONTROLE_COM_TEMPLATE : COLUNAS_DO_CONTROLE;
  return [colunas.join(","), ...linhas].join("\r\n") + "\r\n";
}

/** Planilha de controle de um pacote do caminho sem template (formato inalterado, sem a coluna `template`). */
export function gerarCsvDeControle(pacote: PacoteDeProducao): string {
  return montarCsvDeControle({ itens: pacote.itens, tipo: pacote.modelo.tipo });
}

export function gerarLeiaMe(pacote: PacoteDeProducao, comIndividuais = true): string {
  const { modelo, itens } = pacote;
  const largura = modelo.larguraFinalMm + 2 * modelo.sangriaMm;
  const altura = modelo.alturaFinalMm + 2 * modelo.sangriaMm;
  const partes =
    pacote.totalDePartes > 1
      ? `Parte ${pacote.parte} de ${pacote.totalDePartes} (lote com ${pacote.totalDeCartoesDoLote} cartões).`
      : "Pacote único.";
  return [
    `PACOTE DE PRODUÇÃO — ${pacote.nome}`,
    "",
    `Modelo: ${modelo.nome}`,
    `Cartões neste pacote: ${itens.length} (números ${itens[0].numero} a ${itens[itens.length - 1].numero})`,
    partes,
    "",
    "ARQUIVOS",
    `  ${pacote.nome}.pdf   uma página por cartão, na ordem do controle.csv`,
    `  ${NOME_DO_CSV_DE_CONTROLE}   número, código e URL de cada cartão`,
    comIndividuais
      ? "  individuais/   um PDF por cartão (mesma arte do PDF consolidado)"
      : "  (sem PDFs individuais: a arte é pesada e eles não caberiam no pacote; use o PDF consolidado)",
    "  qr/            QR Code avulso de cada cartão em SVG vetorial",
    "",
    "ESPECIFICAÇÕES DE IMPRESSÃO",
    `  Tamanho final (corte): ${modelo.larguraFinalMm} x ${modelo.alturaFinalMm} mm`,
    `  Sangria: ${modelo.sangriaMm} mm em cada lado (arte de ${largura} x ${altura} mm)`,
    "  As páginas trazem TrimBox (corte) e BleedBox (sangria). Não há marcas de corte.",
    "  Arte e QR Code são vetoriais. Cores em CMYK de dispositivo, sem perfil ICC embutido.",
    "  O QR Code é preto puro (K 100%) sobre branco. Não redimensionar, girar ou sobrepor nada a ele.",
    "  Imprimir em 100% (sem ajustar à página). Este arquivo não é um PDF/X certificado.",
    "",
    "CADA CARTÃO É ÚNICO",
    "  Cada página tem um QR Code diferente. O código impresso abaixo do QR identifica o cartão.",
    "",
    "GRAVAÇÃO DO NFC",
    `  Grave no chip de cada cartão a URL da coluna url_nfc do ${NOME_DO_CSV_DE_CONTROLE},`,
    "  na linha do código impresso naquele cartão. É a mesma URL do QR Code (coluna url_qr).",
    "  Confira o código impresso antes de gravar, para não trocar o chip de um cartão com o de outro.",
    "",
  ].join("\r\n");
}

/** ZIP completo do pacote, gerado em memória. */
export async function gerarZipDoPacote(pacote: PacoteDeProducao): Promise<ArrayBuffer> {
  exigirLimite(pacote);
  const zip = new JSZip();
  const pasta = zip.folder(pacote.nome);
  if (!pasta) throw new Error("Não foi possível montar a estrutura do arquivo ZIP.");

  const pdfDoLote = await gerarPdfDoPacote(pacote);
  const [primeiro, ...demais] = pacote.itens;
  const primeiroIndividual = await gerarPdfDoCartao(primeiro.codigo, pacote.modelo);
  // Os individuais têm todos praticamente o mesmo tamanho: o primeiro serve de medida.
  const comIndividuais =
    pdfDoLote.length + primeiroIndividual.length * pacote.itens.length <= LIMITE_DO_ZIP_BYTES;

  pasta.file(`${pacote.nome}.pdf`, pdfDoLote);
  pasta.file(NOME_DO_CSV_DE_CONTROLE, gerarCsvDeControle(pacote));
  pasta.file(NOME_DO_LEIA_ME, gerarLeiaMe(pacote, comIndividuais));

  if (comIndividuais) {
    pasta.file(`individuais/${primeiro.arquivoPdf}`, primeiroIndividual);
    for (const item of demais) {
      pasta.file(`individuais/${item.arquivoPdf}`, await gerarPdfDoCartao(item.codigo, pacote.modelo));
    }
  }
  for (const item of pacote.itens) {
    pasta.file(`qr/${item.arquivoQr}`, await gerarQrSvg(item.codigo));
  }

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
