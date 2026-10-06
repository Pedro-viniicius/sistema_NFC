// Casos de uso de impressão que partem do banco: carregam cartão/lote e entregam só os CÓDIGOS
// ao gerador. É aqui que o registro do banco (com destino) deixa de seguir adiante.
import type { Cartao, Lote, TemplateDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { buscarLotePorId, buscarLotePorIdentificador } from "@/modules/batches/servico";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { buscarCartaoPorCodigo, listarCartoesDoLote } from "@/modules/cards/repositorio";
import type { ArmazenamentoDeArquivos } from "@/modules/storage/tipos";
import {
  buscarTemplateDoLote,
  carregarArquivoDoLote,
  gerarPdfDoCartaoComTemplate,
  nomeDoPdfDoCartaoComTemplate,
} from "@/modules/templates/producao";
import { obterModeloEfetivo } from "./artes";
import type { ModeloDeImpressao } from "./modelos";
import { gerarPdfDoCartao } from "./pdf";
import { escolherModelo, nomeDoPdfDoCartao, planejarPacote, type PacoteDeProducao } from "./producao";

export interface ArteDoCartao {
  nomeDoArquivo: string;
  modelo: ModeloDeImpressao;
  pdf: Uint8Array;
}

/**
 * Tipos considerados para escolher a arte de um cartão, em ordem: o do lote (que define a arte
 * física fabricada) e depois o do próprio cartão (que pode mudar quando o destino é reconfigurado).
 */
export function tiposParaAArteDoCartao(
  cartao: Pick<Cartao, "tipo">,
  lote: Pick<Lote, "tipo"> | null,
): [Lote["tipo"], Cartao["tipo"]] {
  return [lote?.tipo ?? null, cartao.tipo];
}

/** Arte individual de um cartão existente. Não cria nem altera nada no banco. */
export async function gerarArteDoCartao(
  db: Banco,
  codigoInformado: string,
  slugDoModelo?: string | null,
): Promise<ArteDoCartao> {
  const codigo = normalizarCodigo(codigoInformado);
  const cartao = codigo ? await buscarCartaoPorCodigo(db, codigo) : null;
  if (!cartao) throw new ErroDeDominio("CARTAO_NAO_ENCONTRADO", "Cartão não encontrado.");

  const lote = cartao.loteId ? await buscarLotePorId(db, cartao.loteId) : null;
  const modelo = await obterModeloEfetivo(
    db,
    escolherModelo(slugDoModelo, ...tiposParaAArteDoCartao(cartao, lote)),
  );
  return {
    nomeDoArquivo: nomeDoPdfDoCartao(modelo, cartao.codigo),
    modelo,
    pdf: await gerarPdfDoCartao(cartao.codigo, modelo),
  };
}

export interface ArquivoDeImpressaoDoCartao {
  nomeDoArquivo: string;
  pdf: Uint8Array;
  /** Template do lote do cartão, ou null quando o cartão segue o caminho sem template. */
  template: TemplateDeImpressao | null;
}

/**
 * PDF de impressão de um cartão, pelo caminho que vale para ele:
 *  - cartão de um lote gerado com template → a página do template com o QR do cartão;
 *  - qualquer outro cartão (lotes anteriores aos templates, cartões avulsos) → caminho anterior,
 *    inalterado (`gerarArteDoCartao`).
 * O armazenamento só é consultado quando o lote tem template.
 */
export async function gerarArquivoDeImpressaoDoCartao(
  db: Banco,
  codigoInformado: string,
  slugDoModelo: string | null | undefined,
  obterArmazenamento: () => ArmazenamentoDeArquivos,
): Promise<ArquivoDeImpressaoDoCartao> {
  const codigo = normalizarCodigo(codigoInformado);
  const cartao = codigo ? await buscarCartaoPorCodigo(db, codigo) : null;
  if (!cartao) throw new ErroDeDominio("CARTAO_NAO_ENCONTRADO", "Cartão não encontrado.");

  const lote = cartao.loteId ? await buscarLotePorId(db, cartao.loteId) : null;
  const template = lote ? await buscarTemplateDoLote(db, lote) : null;
  if (!lote || !template || !template.tipo) {
    const arte = await gerarArteDoCartao(db, cartao.codigo, slugDoModelo);
    return { nomeDoArquivo: arte.nomeDoArquivo, pdf: arte.pdf, template: null };
  }

  const arquivo = await carregarArquivoDoLote(obterArmazenamento(), lote, template);
  return {
    nomeDoArquivo: nomeDoPdfDoCartaoComTemplate({ tipo: template.tipo }, cartao.codigo),
    pdf: await gerarPdfDoCartaoComTemplate(arquivo, template, cartao.codigo),
    template,
  };
}

export interface LoteParaProducao {
  lote: Lote;
  cartoes: Cartao[];
}

export async function carregarLoteParaProducao(db: Banco, identificador: string): Promise<LoteParaProducao> {
  const lote = await buscarLotePorIdentificador(db, identificador);
  return { lote, cartoes: await listarCartoesDoLote(db, lote.id) };
}

/** Modelo que vale para o lote: o pedido (ou o do tipo do lote), já com a arte enviada pelo painel, se houver. */
export function resolverModeloDoLote(
  db: Banco,
  lote: Pick<Lote, "tipo">,
  slugDoModelo?: string | null,
): Promise<ModeloDeImpressao> {
  return obterModeloEfetivo(db, escolherModelo(slugDoModelo, lote.tipo));
}

/** Plano validado do pacote de um lote (ou de uma de suas partes). */
export function planejarPacoteDoLote(
  { lote, cartoes }: LoteParaProducao,
  modelo: ModeloDeImpressao,
  parte?: number,
): Promise<PacoteDeProducao> {
  return planejarPacote({
    identificadorDoLote: lote.identificador,
    codigos: cartoes.map((cartao) => cartao.codigo),
    modelo,
    parte,
  });
}
