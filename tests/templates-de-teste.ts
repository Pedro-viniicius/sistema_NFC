// Atalhos para criar templates de impressão nos testes, sempre pelo caminho real do serviço.
import type { TemplateDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import type { TipoDestino } from "@/modules/cards/tipos";
import type { ArmazenamentoDeArquivos } from "@/modules/storage/tipos";
import {
  TIPO_DE_CONTEUDO_DO_TEMPLATE,
  ativarTemplate,
  atualizarDadosDoTemplate,
  configurarQrDoTemplate,
  gerarChaveDoTemplate,
  registrarTemplateEnviado,
  testarQrDoTemplate,
} from "@/modules/templates/servico";
import type { RetanguloPt } from "@/modules/templates/tipos";
import { lerFixture, type NomeDaFixture } from "./fixtures-de-template";
import { criarPdfDeTemplate } from "./pdf-de-template";

/** Espaço em branco reservado para o QR nas artes de exemplo, em pontos. */
export const AREA_DO_QR_NAS_FIXTURES: RetanguloPt = criarPdfDeTemplate().areaDoQr;

/** Simula o envio direto do navegador: o arquivo já está no armazenamento quando o servidor é avisado. */
export async function enviarArquivo(
  armazenamento: ArmazenamentoDeArquivos,
  bytes: Uint8Array,
): Promise<string> {
  const chave = gerarChaveDoTemplate();
  await armazenamento.salvar(chave, bytes, TIPO_DE_CONTEUDO_DO_TEMPLATE);
  return chave;
}

export interface OpcoesDoTemplateDeTeste {
  nome?: string;
  tipo?: TipoDestino;
  fixture?: NomeDaFixture;
  bytes?: Uint8Array;
  nomeDoArquivo?: string;
  padrao?: boolean;
}

/** Rascunho recém-enviado, com nome e produto, mas sem área do QR. */
export async function criarRascunho(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  opcoes: OpcoesDoTemplateDeTeste = {},
): Promise<TemplateDeImpressao> {
  const tipo = opcoes.tipo ?? "GOOGLE";
  const bytes = opcoes.bytes ?? lerFixture(opcoes.fixture ?? (tipo === "INSTAGRAM" ? "template-instagram" : "template-google"));
  const chave = await enviarArquivo(armazenamento, bytes);
  const rascunho = await registrarTemplateEnviado(db, armazenamento, {
    chave,
    nomeOriginal: opcoes.nomeDoArquivo ?? "arte.pdf",
  });
  return atualizarDadosDoTemplate(db, rascunho.id, { nome: opcoes.nome ?? `${tipo} — Modelo 01`, tipo });
}

/** Template PRONTO: enviado, classificado, com a área do QR configurada, testada e ativada. */
export async function criarTemplatePronto(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  opcoes: OpcoesDoTemplateDeTeste = {},
): Promise<TemplateDeImpressao> {
  const rascunho = await criarRascunho(db, armazenamento, opcoes);
  await configurarQrDoTemplate(db, rascunho.id, { area: AREA_DO_QR_NAS_FIXTURES, zonaDeSilencioModulos: 4 });
  await testarQrDoTemplate(db, armazenamento, rascunho.id);
  return ativarTemplate(db, armazenamento, rascunho.id, { definirComoPadrao: opcoes.padrao ?? false });
}
