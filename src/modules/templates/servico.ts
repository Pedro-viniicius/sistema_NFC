// Templates de impressão: cadastro, configuração do QR e ciclo de vida.
//
//   RASCUNHO  → (área do QR configurada + teste bem-sucedido) →  PRONTO  →  INATIVO
//
// Regras centrais:
//  - um arquivo armazenado nunca é sobrescrito; trocar a arte grava um arquivo novo;
//  - quando um lote usa o template, ele fica BLOQUEADO: arquivo e área do QR não mudam mais.
//    Para mudar, duplica-se o template como uma nova versão;
//  - só um template PRONTO pode ser o padrão do produto ou ser usado em um lote novo.
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { lotes, templatesDeImpressao, type TemplateDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { TIPOS_DESTINO, type TipoDestino } from "@/modules/cards/tipos";
import { urlDeTesteDoQr } from "@/modules/cards/url-publica";
import { gerarMatrizDoConteudo } from "@/modules/qr/gerar";
import { ErroDeArquivoGrandeDemais, type ArmazenamentoDeArquivos } from "@/modules/storage/tipos";
import { caixaVisivel, validateQrArea } from "./coordenadas";
import { slugDoNome } from "./formato";
import { renderTemplatePdf } from "./renderizacao";
import {
  ZONA_DE_SILENCIO_MAXIMA,
  ZONA_DE_SILENCIO_MINIMA,
  type CaixaPt,
  type ConfiguracaoDoQr,
  type RetanguloPt,
} from "./tipos";
import { MAX_TEMPLATE_BYTES, calcularSha256, validarPdfDoTemplate, type PdfDeTemplateValidado } from "./validacao-do-pdf";

export const PASTA_DOS_TEMPLATES = "templates-impressao";
export const TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE = 80;
export const TIPO_DE_CONTEUDO_DO_TEMPLATE = "application/pdf";

const FORMATO_DA_CHAVE = new RegExp(`^${PASTA_DOS_TEMPLATES}/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\\.pdf$`);
const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Slug do produto, usado nos nomes de arquivo (ex.: google-K8M4T2.pdf). */
export const SLUG_DO_PRODUTO: Record<TipoDestino, string> = {
  GOOGLE: "google",
  INSTAGRAM: "instagram",
  GENERICO: "generico",
};

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("TEMPLATE_INVALIDO", mensagem);
}

function naoEncontrado(): ErroDeDominio {
  return new ErroDeDominio("TEMPLATE_NAO_ENCONTRADO", "Template de impressão não encontrado.");
}

function bloqueado(): ErroDeDominio {
  return new ErroDeDominio(
    "TEMPLATE_BLOQUEADO",
    "Este template já foi usado em um lote: a arte e a área do QR Code não podem mais mudar. " +
      "Use “Duplicar como nova versão” para criar um template novo a partir dele.",
  );
}

/** Chave nova para um arquivo de template. Nunca reaproveita uma chave existente. */
export function gerarChaveDoTemplate(): string {
  return `${PASTA_DOS_TEMPLATES}/${randomUUID()}.pdf`;
}

export function chaveDeTemplateValida(chave: unknown): chave is string {
  return typeof chave === "string" && FORMATO_DA_CHAVE.test(chave) && !chave.includes("..");
}

/** Página visível do template (CropBox limitada à MediaBox): é a referência das medidas do QR. */
export function visaoDoTemplate(template: Pick<TemplateDeImpressao, "mediaBox" | "cropBox">): CaixaPt {
  return caixaVisivel(template.mediaBox, template.cropBox);
}

export function configuracaoDoQr(template: TemplateDeImpressao): ConfiguracaoDoQr | null {
  const { qrXPt, qrYPt, qrLarguraPt, qrAlturaPt } = template;
  if (qrXPt === null || qrYPt === null || qrLarguraPt === null || qrAlturaPt === null) return null;
  return {
    area: { x: qrXPt, y: qrYPt, largura: qrLarguraPt, altura: qrAlturaPt },
    zonaDeSilencioModulos: template.qrZonaDeSilencioModulos,
  };
}

export function templateBloqueado(template: Pick<TemplateDeImpressao, "bloqueadoEm">): boolean {
  return template.bloqueadoEm !== null;
}

/** O teste do QR vale enquanto for posterior à última alteração da área. */
export function qrTestado(template: Pick<TemplateDeImpressao, "qrTestadoEm" | "qrConfiguradoEm">): boolean {
  return (
    template.qrTestadoEm !== null &&
    template.qrConfiguradoEm !== null &&
    template.qrTestadoEm.getTime() >= template.qrConfiguradoEm.getTime()
  );
}

/** O que ainda falta para o template poder ficar PRONTO. Lista vazia = pode ativar. */
export function pendenciasParaAtivar(template: TemplateDeImpressao): string[] {
  const pendencias: string[] = [];
  if (!template.tipo) pendencias.push("Escolha o produto do template.");
  if (!configuracaoDoQr(template)) pendencias.push("Configure a área do QR Code.");
  else if (!qrTestado(template)) pendencias.push("Faça o teste do QR Code com a configuração atual.");
  return pendencias;
}

/** Quantidade de módulos por lado do QR de uma URL permanente deste sistema (a de teste tem o mesmo tamanho). */
export function modulosDoQrDeProducao(): number {
  return gerarMatrizDoConteudo(urlDeTesteDoQr()).lado;
}

async function exigirTemplate(db: Banco, id: string, paraAlterar = false): Promise<TemplateDeImpressao> {
  if (!FORMATO_DE_UUID.test(id)) throw naoEncontrado();
  const consulta = db.select().from(templatesDeImpressao).where(eq(templatesDeImpressao.id, id));
  const [template] = paraAlterar ? await consulta.for("update") : await consulta.limit(1);
  if (!template) throw naoEncontrado();
  return template;
}

export async function buscarTemplate(db: Banco, id: string): Promise<TemplateDeImpressao | null> {
  if (!FORMATO_DE_UUID.test(id)) return null;
  const [template] = await db.select().from(templatesDeImpressao).where(eq(templatesDeImpressao.id, id)).limit(1);
  return template ?? null;
}

export interface TemplateComUso extends TemplateDeImpressao {
  /** Quantidade de lotes gerados com este template. */
  lotes: number;
}

export async function listarTemplates(db: Banco): Promise<TemplateComUso[]> {
  const [templates, usos] = await Promise.all([
    db.select().from(templatesDeImpressao).orderBy(asc(templatesDeImpressao.tipo), asc(templatesDeImpressao.nome)),
    db
      .select({ templateId: lotes.templateId, quantidade: count() })
      .from(lotes)
      .where(sql`${lotes.templateId} is not null`)
      .groupBy(lotes.templateId),
  ]);
  const porTemplate = new Map(usos.map((uso) => [uso.templateId, uso.quantidade]));
  return templates.map((template) => ({ ...template, lotes: porTemplate.get(template.id) ?? 0 }));
}

export async function contarLotesDoTemplate(db: Banco, id: string): Promise<number> {
  const [{ quantidade }] = await db.select({ quantidade: count() }).from(lotes).where(eq(lotes.templateId, id));
  return quantidade;
}

/** Templates que podem ser escolhidos para um lote novo: só os PRONTOS. O padrão vem primeiro. */
export async function listarTemplatesParaNovosLotes(
  db: Banco,
): Promise<Pick<TemplateDeImpressao, "id" | "nome" | "tipo" | "padrao">[]> {
  return db
    .select({
      id: templatesDeImpressao.id,
      nome: templatesDeImpressao.nome,
      tipo: templatesDeImpressao.tipo,
      padrao: templatesDeImpressao.padrao,
    })
    .from(templatesDeImpressao)
    .where(eq(templatesDeImpressao.status, "PRONTO"))
    .orderBy(sql`${templatesDeImpressao.padrao} desc`, asc(templatesDeImpressao.nome));
}

export interface ArquivoEnviado {
  /** Chave do arquivo no armazenamento, devolvida pelo envio direto do navegador. */
  chave: string;
  /** Nome do arquivo no computador do administrador. Não é confiável: só serve para exibição. */
  nomeOriginal: string;
}

/**
 * Baixa o arquivo recém-enviado e faz a validação completa. Se o arquivo não servir, ele é
 * apagado do armazenamento antes de o erro ser devolvido: não ficam arquivos órfãos.
 */
async function lerEValidarEnvio(
  armazenamento: ArmazenamentoDeArquivos,
  envio: ArquivoEnviado,
): Promise<PdfDeTemplateValidado> {
  if (!chaveDeTemplateValida(envio.chave)) throw falha("Referência de arquivo inválida.");

  let bytes: Uint8Array | null;
  try {
    bytes = await armazenamento.ler(envio.chave, { limiteBytes: MAX_TEMPLATE_BYTES });
  } catch (erro) {
    if (!(erro instanceof ErroDeArquivoGrandeDemais)) throw erro;
    await armazenamento.excluir(envio.chave);
    throw falha(`O arquivo é maior que o tamanho máximo de um template (${MAX_TEMPLATE_BYTES / 1024 / 1024} MB).`);
  }
  if (!bytes) throw falha("O arquivo enviado não foi encontrado no armazenamento. Envie-o novamente.");

  try {
    return await validarPdfDoTemplate(bytes, envio.nomeOriginal);
  } catch (erro) {
    await armazenamento.excluir(envio.chave);
    throw erro;
  }
}

function metadadosDoArquivo(chave: string, pdf: PdfDeTemplateValidado) {
  return {
    chaveDoArquivo: chave,
    arquivoNomeOriginal: pdf.arquivoNomeOriginal,
    mimeType: TIPO_DE_CONTEUDO_DO_TEMPLATE,
    tamanhoBytes: pdf.tamanhoBytes,
    sha256: pdf.sha256,
    numeroDePaginas: pdf.numeroDePaginas,
    rotacao: pdf.rotacao,
    mediaBox: pdf.mediaBox,
    cropBox: pdf.cropBox,
    trimBox: pdf.trimBox,
    bleedBox: pdf.bleedBox,
    larguraDaPaginaMm: pdf.larguraDaPaginaMm,
    alturaDaPaginaMm: pdf.alturaDaPaginaMm,
  };
}

function nomeAPartirDoArquivo(nomeDoArquivo: string): string {
  const semExtensao = nomeDoArquivo.replace(/\.pdf$/i, "").trim().slice(0, TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE).trim();
  return semExtensao.length > 0 ? semExtensao : "Template sem nome";
}

/**
 * Registra como RASCUNHO o PDF que o navegador acabou de enviar direto para o armazenamento.
 * Chamar de novo com a mesma chave devolve o mesmo rascunho (não cria outro).
 */
export async function registrarTemplateEnviado(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  envio: ArquivoEnviado,
): Promise<TemplateDeImpressao> {
  if (!chaveDeTemplateValida(envio.chave)) throw falha("Referência de arquivo inválida.");
  const [existente] = await db
    .select()
    .from(templatesDeImpressao)
    .where(eq(templatesDeImpressao.chaveDoArquivo, envio.chave))
    .limit(1);
  if (existente) return existente;

  const pdf = await lerEValidarEnvio(armazenamento, envio);
  try {
    const [template] = await db
      .insert(templatesDeImpressao)
      .values({ nome: nomeAPartirDoArquivo(pdf.arquivoNomeOriginal), ...metadadosDoArquivo(envio.chave, pdf) })
      .returning();
    return template;
  } catch (erro) {
    await armazenamento.excluir(envio.chave);
    throw erro;
  }
}

/**
 * Troca a arte de um template ainda não usado por nenhum lote. O arquivo antigo não é
 * sobrescrito: o novo é outro objeto no armazenamento, e o antigo é apagado depois da troca.
 * A área do QR é mantida se ainda couber na nova página; o teste precisa ser refeito.
 */
export async function substituirArquivoDoTemplate(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  id: string,
  envio: ArquivoEnviado,
): Promise<TemplateDeImpressao> {
  const atual = await buscarTemplate(db, id);
  if (!atual || templateBloqueado(atual) || !chaveDeTemplateValida(envio.chave) || envio.chave === atual.chaveDoArquivo) {
    // O arquivo recém-enviado não será usado: não pode ficar órfão no armazenamento.
    if (chaveDeTemplateValida(envio.chave) && envio.chave !== atual?.chaveDoArquivo) {
      await armazenamento.excluir(envio.chave);
    }
    if (!atual) throw naoEncontrado();
    if (templateBloqueado(atual)) throw bloqueado();
    throw falha("Referência de arquivo inválida.");
  }

  const pdf = await lerEValidarEnvio(armazenamento, envio);
  let chaveAntiga: string;
  try {
    const atualizado = await db.transaction(async (tx) => {
      const template = await exigirTemplate(tx, id, true);
      if (templateBloqueado(template)) throw bloqueado();
      chaveAntiga = template.chaveDoArquivo;

      const config = configuracaoDoQr(template);
      const areaAindaCabe =
        config !== null && validateQrArea(config.area, caixaVisivel(pdf.mediaBox, pdf.cropBox)).length === 0;
      const agora = new Date();
      const [linha] = await tx
        .update(templatesDeImpressao)
        .set({
          ...metadadosDoArquivo(envio.chave, pdf),
          ...(areaAindaCabe ? {} : { qrXPt: null, qrYPt: null, qrLarguraPt: null, qrAlturaPt: null }),
          qrConfiguradoEm: areaAindaCabe ? agora : null,
          qrTestadoEm: null,
          status: "RASCUNHO",
          padrao: false,
          atualizadoEm: agora,
        })
        .where(eq(templatesDeImpressao.id, id))
        .returning();
      return linha;
    });
    await armazenamento.excluir(chaveAntiga!);
    return atualizado;
  } catch (erro) {
    await armazenamento.excluir(envio.chave);
    throw erro;
  }
}

export const esquemaDosDadosDoTemplate = z.object({
  nome: z
    .string("Informe o nome do template.")
    .trim()
    .min(1, "Informe o nome do template.")
    .max(TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE} caracteres.`),
  tipo: z.enum(TIPOS_DESTINO, "Escolha o produto do template.").nullable(),
});

export type DadosDoTemplate = z.infer<typeof esquemaDosDadosDoTemplate>;

/** Renomeia o template e define o produto. O produto só muda enquanto o template não está bloqueado. */
export async function atualizarDadosDoTemplate(db: Banco, id: string, entrada: unknown): Promise<TemplateDeImpressao> {
  const dados = esquemaDosDadosDoTemplate.parse(entrada);
  return db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    const mudouOProduto = dados.tipo !== template.tipo;
    if (mudouOProduto && templateBloqueado(template)) {
      throw new ErroDeDominio(
        "TEMPLATE_BLOQUEADO",
        "Este template já foi usado em um lote: o produto não pode mais mudar. O nome pode.",
      );
    }
    if (mudouOProduto && dados.tipo === null && template.status === "PRONTO") {
      throw falha("Um template pronto precisa ter um produto.");
    }
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({
        nome: dados.nome,
        tipo: dados.tipo,
        // O padrão é por produto: ao mudar de produto, o template deixa de ser o padrão do anterior.
        ...(mudouOProduto ? { padrao: false } : {}),
        atualizadoEm: new Date(),
      })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

const medidaEmPontos = z.number("A área do QR Code tem medidas inválidas.").finite("A área do QR Code tem medidas inválidas.");

export const esquemaDaAreaDoQr = z.object({
  area: z.object({ x: medidaEmPontos, y: medidaEmPontos, largura: medidaEmPontos, altura: medidaEmPontos }),
  zonaDeSilencioModulos: z
    .number("Informe a zona de silêncio do QR Code.")
    .int("A zona de silêncio deve ser um número inteiro de módulos.")
    .min(ZONA_DE_SILENCIO_MINIMA, `A zona de silêncio mínima é de ${ZONA_DE_SILENCIO_MINIMA} módulos.`)
    .max(ZONA_DE_SILENCIO_MAXIMA, `A zona de silêncio máxima é de ${ZONA_DE_SILENCIO_MAXIMA} módulos.`),
});

function mesmaArea(a: RetanguloPt, b: RetanguloPt): boolean {
  return (["x", "y", "largura", "altura"] as const).every((campo) => Math.abs(a[campo] - b[campo]) < 1e-6);
}

/**
 * Grava a área do QR (em pontos). Qualquer mudança invalida o teste anterior e devolve o template
 * a RASCUNHO. Gravar exatamente a mesma configuração não muda nada.
 */
export async function configurarQrDoTemplate(db: Banco, id: string, entrada: unknown): Promise<TemplateDeImpressao> {
  const nova = esquemaDaAreaDoQr.parse(entrada);
  return db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    const atual = configuracaoDoQr(template);
    if (atual && mesmaArea(atual.area, nova.area) && atual.zonaDeSilencioModulos === nova.zonaDeSilencioModulos) {
      return template;
    }
    if (templateBloqueado(template)) throw bloqueado();

    const problemas = validateQrArea(nova.area, visaoDoTemplate(template));
    if (problemas.length > 0) throw falha(problemas.join(" "));

    const agora = new Date();
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({
        qrXPt: nova.area.x,
        qrYPt: nova.area.y,
        qrLarguraPt: nova.area.largura,
        qrAlturaPt: nova.area.altura,
        qrZonaDeSilencioModulos: nova.zonaDeSilencioModulos,
        qrConfiguradoEm: agora,
        qrTestadoEm: null,
        status: "RASCUNHO",
        padrao: false,
        atualizadoEm: agora,
      })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

/**
 * Lê o arquivo do template e confere a integridade: o SHA-256 precisa ser o registrado
 * (e, quando informado, o que o lote guardou ao ser criado).
 */
export async function carregarArquivoDoTemplate(
  armazenamento: ArmazenamentoDeArquivos,
  template: Pick<TemplateDeImpressao, "chaveDoArquivo" | "sha256" | "nome">,
  sha256Esperado: string = template.sha256,
): Promise<Uint8Array> {
  const bytes = await armazenamento.ler(template.chaveDoArquivo, { limiteBytes: MAX_TEMPLATE_BYTES });
  if (!bytes) {
    throw falha(`O arquivo do template “${template.nome}” não está mais no armazenamento.`);
  }
  if (sha256Esperado !== template.sha256 || calcularSha256(bytes) !== sha256Esperado) {
    throw falha(`O arquivo do template “${template.nome}” não é o mesmo que foi registrado. A geração foi interrompida.`);
  }
  return bytes;
}

export interface PdfDeTeste {
  pdf: Uint8Array;
  /** Ex.: teste-template-google-google-modelo-01.pdf */
  nomeDoArquivo: string;
  urlDeTeste: string;
}

export function nomeDoPdfDeTeste(template: Pick<TemplateDeImpressao, "nome" | "tipo">): string {
  const produto = template.tipo ? SLUG_DO_PRODUTO[template.tipo] : "sem-produto";
  return `teste-template-${produto}-${slugDoNome(template.nome)}.pdf`;
}

/**
 * PDF de teste: exatamente o PDF enviado, mais o QR da URL reservada de teste (que nunca pertence
 * a um cartão). Não cria cartão e não altera o template.
 */
export async function gerarPdfDeTeste(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  id: string,
): Promise<PdfDeTeste> {
  const template = await exigirTemplate(db, id);
  const config = configuracaoDoQr(template);
  if (!config) throw falha("Configure a área do QR Code antes de testar.");
  const urlDeTeste = urlDeTesteDoQr();
  const bytes = await carregarArquivoDoTemplate(armazenamento, template);
  return {
    pdf: await renderTemplatePdf(bytes, config, [urlDeTeste]),
    nomeDoArquivo: nomeDoPdfDeTeste(template),
    urlDeTeste,
  };
}

/**
 * Teste do QR no servidor: gera de verdade o PDF final com a configuração atual. Se der certo,
 * registra a data do teste — é o que libera “Salvar e ativar”.
 */
export async function testarQrDoTemplate(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  id: string,
): Promise<TemplateDeImpressao> {
  const antes = await exigirTemplate(db, id);
  await gerarPdfDeTeste(db, armazenamento, id);

  return db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    // Se a área mudou enquanto o teste rodava, o teste não vale para a nova configuração.
    if (template.qrConfiguradoEm?.getTime() !== antes.qrConfiguradoEm?.getTime() || template.sha256 !== antes.sha256) {
      throw falha("A configuração do template mudou durante o teste. Teste novamente.");
    }
    const agora = new Date();
    const testadoEm =
      template.qrConfiguradoEm && template.qrConfiguradoEm.getTime() > agora.getTime() ? template.qrConfiguradoEm : agora;
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({ qrTestadoEm: testadoEm, atualizadoEm: agora })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

async function tornarPadrao(tx: Banco, template: TemplateDeImpressao): Promise<void> {
  if (!template.tipo) throw falha("Escolha o produto do template.");
  // Primeiro tira o padrão atual do produto: o banco só admite um por produto.
  await tx
    .update(templatesDeImpressao)
    .set({ padrao: false, atualizadoEm: new Date() })
    .where(
      and(
        eq(templatesDeImpressao.tipo, template.tipo),
        eq(templatesDeImpressao.padrao, true),
        ne(templatesDeImpressao.id, template.id),
      ),
    );
}

/**
 * “Salvar e ativar” (e também reativar um template inativo): o template passa a PRONTO.
 * Exige produto, área do QR, teste válido e o arquivo presente no armazenamento.
 */
export async function ativarTemplate(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  id: string,
  opcoes: { definirComoPadrao?: boolean } = {},
): Promise<TemplateDeImpressao> {
  const previa = await exigirTemplate(db, id);
  if (!(await armazenamento.existe(previa.chaveDoArquivo))) {
    throw falha("O arquivo deste template não está mais no armazenamento. Envie a arte novamente.");
  }
  return db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    const pendencias = pendenciasParaAtivar(template);
    if (pendencias.length > 0) throw falha(`Ainda não é possível ativar o template. ${pendencias.join(" ")}`);

    if (opcoes.definirComoPadrao) await tornarPadrao(tx, template);
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({
        status: "PRONTO",
        padrao: opcoes.definirComoPadrao ? true : template.padrao,
        atualizadoEm: new Date(),
      })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

/** Define ou retira o template como padrão do seu produto. Só um PRONTO pode ser padrão. */
export async function definirTemplatePadrao(db: Banco, id: string, padrao: boolean): Promise<TemplateDeImpressao> {
  return db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    if (padrao) {
      if (template.status !== "PRONTO") throw falha("Só um template pronto pode ser o padrão do produto.");
      await tornarPadrao(tx, template);
    }
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({ padrao, atualizadoEm: new Date() })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

/**
 * INATIVO: o template deixa de ser oferecido para lotes NOVOS. Os lotes já gerados com ele
 * continuam podendo baixar seus arquivos, sempre com este mesmo template.
 */
export async function inativarTemplate(db: Banco, id: string): Promise<TemplateDeImpressao> {
  return db.transaction(async (tx) => {
    await exigirTemplate(tx, id, true);
    const [atualizado] = await tx
      .update(templatesDeImpressao)
      .set({ status: "INATIVO", padrao: false, atualizadoEm: new Date() })
      .where(eq(templatesDeImpressao.id, id))
      .returning();
    return atualizado;
  });
}

/** “Google — Modelo 01” → “Google — Modelo 02”; sem número no fim → “… (nova versão)”. */
export function nomeDaNovaVersao(nome: string, existentes: readonly string[]): string {
  const usados = new Set(existentes.map((existente) => existente.trim().toLowerCase()));
  const limitar = (texto: string) => texto.slice(0, TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE).trim();
  const numerado = /^(.*?)(\d+)$/.exec(nome.trim());

  if (numerado) {
    const [, prefixo, numero] = numerado;
    for (let proximo = Number(numero) + 1; proximo < Number(numero) + 1000; proximo++) {
      const candidato = limitar(`${prefixo}${String(proximo).padStart(numero.length, "0")}`);
      if (!usados.has(candidato.toLowerCase())) return candidato;
    }
  }
  const base = limitar(`${nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE - 20)} (nova versão)`);
  if (!usados.has(base.toLowerCase())) return base;
  for (let versao = 2; ; versao++) {
    const candidato = limitar(`${nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE - 24)} (nova versão ${versao})`);
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
}

/**
 * “Duplicar como nova versão”: cria um RASCUNHO com a mesma arte (em um arquivo próprio no
 * armazenamento) e a mesma área do QR. É o caminho para mudar um template bloqueado.
 */
export async function duplicarTemplate(
  db: Banco,
  armazenamento: ArmazenamentoDeArquivos,
  id: string,
): Promise<TemplateDeImpressao> {
  const origem = await exigirTemplate(db, id);
  const bytes = await carregarArquivoDoTemplate(armazenamento, origem);
  const chave = gerarChaveDoTemplate();
  await armazenamento.salvar(chave, bytes, TIPO_DE_CONTEUDO_DO_TEMPLATE);

  try {
    const nomes = await db.select({ nome: templatesDeImpressao.nome }).from(templatesDeImpressao);
    const temArea = configuracaoDoQr(origem) !== null;
    const [copia] = await db
      .insert(templatesDeImpressao)
      .values({
        nome: nomeDaNovaVersao(origem.nome, nomes.map((linha) => linha.nome)),
        tipo: origem.tipo,
        chaveDoArquivo: chave,
        arquivoNomeOriginal: origem.arquivoNomeOriginal,
        mimeType: origem.mimeType,
        tamanhoBytes: origem.tamanhoBytes,
        sha256: origem.sha256,
        numeroDePaginas: origem.numeroDePaginas,
        rotacao: origem.rotacao,
        mediaBox: origem.mediaBox,
        cropBox: origem.cropBox,
        trimBox: origem.trimBox,
        bleedBox: origem.bleedBox,
        larguraDaPaginaMm: origem.larguraDaPaginaMm,
        alturaDaPaginaMm: origem.alturaDaPaginaMm,
        qrXPt: origem.qrXPt,
        qrYPt: origem.qrYPt,
        qrLarguraPt: origem.qrLarguraPt,
        qrAlturaPt: origem.qrAlturaPt,
        qrZonaDeSilencioModulos: origem.qrZonaDeSilencioModulos,
        qrConfiguradoEm: temArea ? new Date() : null,
      })
      .returning();
    return copia;
  } catch (erro) {
    await armazenamento.excluir(chave);
    throw erro;
  }
}

/** A exclusão definitiva só é permitida enquanto nenhum lote usa o template. */
export async function templatePodeSerExcluido(db: Banco, id: string): Promise<boolean> {
  return (await contarLotesDoTemplate(db, id)) === 0;
}

/**
 * Apaga o registro e o arquivo. Recusado quando algum lote usa o template: nesse caso, o
 * caminho é inativar.
 */
export async function excluirTemplate(db: Banco, armazenamento: ArmazenamentoDeArquivos, id: string): Promise<void> {
  const chave = await db.transaction(async (tx) => {
    const template = await exigirTemplate(tx, id, true);
    if ((await contarLotesDoTemplate(tx, id)) > 0) {
      throw new ErroDeDominio(
        "TEMPLATE_BLOQUEADO",
        "Este template já foi usado em lotes e não pode ser excluído. Se não for mais usar, inative-o.",
      );
    }
    await tx.delete(templatesDeImpressao).where(eq(templatesDeImpressao.id, id));
    return template.chaveDoArquivo;
  });
  await armazenamento.excluir(chave);
}

/**
 * Valida o template escolhido para um lote NOVO e o bloqueia. Deve rodar dentro da transação
 * que cria o lote. Recusa rascunhos, inativos e templates de outro produto.
 */
export async function reservarTemplateParaNovoLote(
  tx: Banco,
  templateId: string,
  tipoDoLote: TipoDestino | null,
): Promise<TemplateDeImpressao> {
  if (!FORMATO_DE_UUID.test(templateId)) throw naoEncontrado();
  const [template] = await tx
    .select()
    .from(templatesDeImpressao)
    .where(eq(templatesDeImpressao.id, templateId))
    .for("update");
  if (!template) throw naoEncontrado();
  if (template.status !== "PRONTO") {
    throw falha(
      template.status === "INATIVO"
        ? `O template “${template.nome}” está inativo e não pode ser usado em novos lotes.`
        : `O template “${template.nome}” ainda é um rascunho. Teste o QR Code e ative-o antes de usar.`,
    );
  }
  if (!tipoDoLote || template.tipo !== tipoDoLote) {
    throw falha(`O template “${template.nome}” é de outro produto e não pode ser usado neste lote.`);
  }
  if (!configuracaoDoQr(template) || !qrTestado(template)) {
    throw falha(`O template “${template.nome}” não tem um QR Code testado.`);
  }
  if (template.bloqueadoEm) return template;

  const [bloqueadoAgora] = await tx
    .update(templatesDeImpressao)
    .set({ bloqueadoEm: new Date() })
    .where(eq(templatesDeImpressao.id, templateId))
    .returning();
  return bloqueadoAgora;
}

/**
 * Ao apagar um lote: se nenhum outro lote usa o template, ele volta a poder ser editado
 * (deixa de existir qualquer produção ligada a ele).
 */
export async function liberarTemplateSemLotes(tx: Banco, templateId: string): Promise<void> {
  if ((await contarLotesDoTemplate(tx, templateId)) > 0) return;
  await tx.update(templatesDeImpressao).set({ bloqueadoEm: null }).where(eq(templatesDeImpressao.id, templateId));
}
