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
 * Limite de cartões por pacote, definido por medição (Node 22, arte-base de 8 KB):
 *   100 cartões → ZIP de 2,2 MB, 0,6 s, ~30 MB de memória;
 *   250 cartões → ZIP de 5,4 MB, acima do teto de 4,5 MB por resposta das funções da Vercel.
 * Com 100 há cerca de 2× de folga. Lotes maiores são divididos em partes de até 100 cartões.
 * Se a arte definitiva for muito mais pesada que a arte-base, meça de novo antes de aumentar.
 */
export const MAXIMO_DE_CARTOES_POR_PACOTE = 100;

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
  for (const tipo of tipos) {
    const modelo = obterModelo(tipo);
    if (modelo) return modelo;
  }
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
 * Planilha de controle (UTF-8, separada por vírgulas). `url_nfc` e `url_qr` existem para deixar
 * explícito que o chip e o QR de cada cartão recebem a MESMA URL: as duas colunas saem da mesma
 * função canônica (a do QR passa pelo próprio módulo que desenha o QR).
 * Todos os valores vêm de alfabetos controlados: não há vírgulas, aspas ou fórmulas a escapar.
 */
export function gerarCsvDeControle(pacote: PacoteDeProducao): string {
  const linhas = pacote.itens.map((item) =>
    [
      item.numero,
      item.codigo,
      pacote.modelo.tipo,
      item.url,
      getCardPublicUrl(item.codigo),
      conteudoDoQr(item.codigo),
      item.arquivoPdf,
      item.arquivoQr,
    ].join(","),
  );
  return [COLUNAS_DO_CONTROLE.join(","), ...linhas].join("\r\n") + "\r\n";
}

export function gerarLeiaMe(pacote: PacoteDeProducao): string {
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
    "  individuais/   um PDF por cartão (mesma arte do PDF consolidado)",
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
  const individuais = pasta?.folder("individuais");
  const qr = pasta?.folder("qr");
  if (!pasta || !individuais || !qr) throw new Error("Não foi possível montar a estrutura do arquivo ZIP.");

  pasta.file(`${pacote.nome}.pdf`, await gerarPdfDoPacote(pacote));
  pasta.file(NOME_DO_CSV_DE_CONTROLE, gerarCsvDeControle(pacote));
  pasta.file(NOME_DO_LEIA_ME, gerarLeiaMe(pacote));
  for (const item of pacote.itens) {
    individuais.file(item.arquivoPdf, await gerarPdfDoCartao(item.codigo, pacote.modelo));
    qr.file(item.arquivoQr, await gerarQrSvg(item.codigo));
  }

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
