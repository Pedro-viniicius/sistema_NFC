// Contatos de quem ativou um cartão: lista, acompanhamento da venda, exportação e exclusão.
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { contatos, type Contato } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { formatarWhatsApp } from "@/modules/activation/whatsapp";
import { ROTULO_TIPO } from "@/modules/cards/tipos";
import {
  PAPEL_NO_PAINEL,
  ROTULO_RAMO,
  ROTULO_SITUACAO,
  SITUACOES_DO_CONTATO,
  TAMANHO_MAXIMO_DA_OBSERVACAO,
  type SituacaoDoContato,
} from "./tipos";

const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Máximo de contatos por consulta (lista e exportação). */
export const MAXIMO_DE_CONTATOS_POR_CONSULTA = 5000;

export interface FiltroDeContatos {
  /** Texto livre: loja, nome, quem decide, WhatsApp ou código do cartão. */
  busca?: string;
  /** Identificador do lote (ex.: lote-2026-001). */
  lote?: string;
  situacao?: SituacaoDoContato;
  /** true = só quem aceitou ofertas; false = só quem não aceitou. */
  aceitouOfertas?: boolean;
}

export interface ContatoNaLista extends Contato {
  /** Quantos cartões foram ativados com este mesmo WhatsApp (a loja tem vários cartões). */
  cartoesDaLoja: number;
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

function condicoes(filtro: FiltroDeContatos): SQL | undefined {
  const lista: SQL[] = [];
  if (filtro.lote) lista.push(eq(contatos.loteIdentificador, filtro.lote));
  if (filtro.situacao) lista.push(eq(contatos.situacao, filtro.situacao));
  if (filtro.aceitouOfertas !== undefined) lista.push(eq(contatos.aceitouOfertas, filtro.aceitouOfertas));

  const busca = filtro.busca?.trim();
  if (busca) {
    const padrao = `%${escaparLike(busca)}%`;
    const digitos = busca.replace(/\D/g, "");
    const porTexto = or(
      ilike(contatos.loja, padrao),
      ilike(contatos.nome, padrao),
      ilike(contatos.decisor, padrao),
      ilike(contatos.cartaoCodigo, padrao),
      // Busca por telefone: compara só os dígitos, com qualquer formatação digitada.
      ...(digitos.length >= 4 ? [ilike(contatos.whatsapp, `%${digitos}%`)] : []),
    );
    if (porTexto) lista.push(porTexto);
  }
  return lista.length > 0 ? and(...lista) : undefined;
}

/** Contatos mais recentes primeiro, com a indicação de quantos cartões cada loja ativou. */
export async function listarContatos(db: Banco, filtro: FiltroDeContatos = {}): Promise<ContatoNaLista[]> {
  const linhas = await db
    .select()
    .from(contatos)
    .where(condicoes(filtro))
    .orderBy(desc(contatos.registradoEm))
    .limit(MAXIMO_DE_CONTATOS_POR_CONSULTA);
  if (linhas.length === 0) return [];

  // A contagem por WhatsApp considera TODOS os contatos, não só os que passaram no filtro.
  const numeros = [...new Set(linhas.map((linha) => linha.whatsapp))];
  const porNumero = await db
    .select({ whatsapp: contatos.whatsapp, quantidade: count() })
    .from(contatos)
    .where(inArray(contatos.whatsapp, numeros))
    .groupBy(contatos.whatsapp);
  const quantidades = new Map(porNumero.map((linha) => [linha.whatsapp, linha.quantidade]));
  return linhas.map((linha) => ({ ...linha, cartoesDaLoja: quantidades.get(linha.whatsapp) ?? 1 }));
}

/** Quantos contatos ainda estão como "Novo": é o contador mostrado no menu do painel. */
export async function contarContatosNovos(db: Banco): Promise<number> {
  const [linha] = await db.select({ quantidade: count() }).from(contatos).where(eq(contatos.situacao, "NOVO"));
  return linha?.quantidade ?? 0;
}

/** Lotes que têm contatos, para o filtro da lista. */
export async function listarLotesComContatos(db: Banco): Promise<string[]> {
  const linhas = await db
    .selectDistinct({ lote: contatos.loteIdentificador })
    .from(contatos)
    .where(sql`${contatos.loteIdentificador} is not null`)
    .orderBy(desc(contatos.loteIdentificador));
  return linhas.map((linha) => linha.lote).filter((lote): lote is string => lote !== null);
}

export async function buscarContato(db: Banco, id: string): Promise<ContatoNaLista | null> {
  if (!FORMATO_DE_UUID.test(id)) return null;
  const [contato] = await db.select().from(contatos).where(eq(contatos.id, id)).limit(1);
  if (!contato) return null;
  const [{ quantidade }] = await db
    .select({ quantidade: count() })
    .from(contatos)
    .where(eq(contatos.whatsapp, contato.whatsapp));
  return { ...contato, cartoesDaLoja: quantidade };
}

/** Contato de quem ativou o cartão, ou null (cartão ativado pelo painel, ou contato já excluído). */
export async function buscarContatoDoCartao(db: Banco, cartaoId: string): Promise<Contato | null> {
  const [contato] = await db.select().from(contatos).where(eq(contatos.cartaoId, cartaoId)).limit(1);
  return contato ?? null;
}

/** Quantos cartões de um lote foram ativados pelo próprio cliente. */
export async function contarContatosDoLote(db: Banco, loteIdentificador: string): Promise<number> {
  const [linha] = await db
    .select({ quantidade: count() })
    .from(contatos)
    .where(eq(contatos.loteIdentificador, loteIdentificador));
  return linha?.quantidade ?? 0;
}

export const esquemaDoAcompanhamento = z.object({
  situacao: z.enum(SITUACOES_DO_CONTATO, "Escolha a situação do contato."),
  observacao: z
    .string()
    .max(TAMANHO_MAXIMO_DA_OBSERVACAO, `A observação deve ter no máximo ${TAMANHO_MAXIMO_DA_OBSERVACAO} caracteres.`)
    .transform((texto) => (texto.trim().length > 0 ? texto.trim() : null))
    .nullable()
    .optional(),
});

/** Atualiza a situação (e, se informada, a observação) do contato. */
export async function atualizarAcompanhamento(db: Banco, id: string, entrada: unknown): Promise<Contato> {
  const dados = esquemaDoAcompanhamento.parse(entrada);
  if (!FORMATO_DE_UUID.test(id)) throw new ErroDeDominio("ENTRADA_INVALIDA", "Contato não encontrado.");
  const [atualizado] = await db
    .update(contatos)
    .set({
      situacao: dados.situacao,
      ...(dados.observacao !== undefined ? { observacao: dados.observacao } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(contatos.id, id))
    .returning();
  if (!atualizado) throw new ErroDeDominio("ENTRADA_INVALIDA", "Contato não encontrado.");
  return atualizado;
}

/**
 * Exclui o contato a pedido do titular dos dados. Todos os dados pessoais são apagados de vez.
 * O cartão NÃO é tocado: continua ativo e abrindo o mesmo link.
 */
export async function excluirContato(db: Banco, id: string): Promise<{ cartaoCodigo: string }> {
  if (!FORMATO_DE_UUID.test(id)) throw new ErroDeDominio("ENTRADA_INVALIDA", "Contato não encontrado.");
  const [excluido] = await db
    .delete(contatos)
    .where(eq(contatos.id, id))
    .returning({ cartaoCodigo: contatos.cartaoCodigo });
  if (!excluido) throw new ErroDeDominio("ENTRADA_INVALIDA", "Contato não encontrado.");
  return excluido;
}

/** Quem decide as coisas na loja: a própria pessoa, quando é o dono; senão, o nome informado. */
export function quemDecide(contato: Pick<Contato, "nome" | "papel" | "decisor">): string {
  return contato.papel === "DONO" ? contato.nome : (contato.decisor ?? "—");
}

export const COLUNAS_DO_CSV_DE_CONTATOS = [
  "loja",
  "nome",
  "funcao",
  "quem_decide",
  "whatsapp",
  "whatsapp_com_ddi",
  "ramo",
  "cartao",
  "lote",
  "tipo",
  "ativado_em",
  "aceitou_ofertas",
  "situacao",
  "observacao",
  "cartoes_da_loja",
] as const;

/**
 * Protege um valor para o CSV:
 *  - valores que começam com =, +, - ou @ (ou tabulação/quebra de linha) ganham um apóstrofo na
 *    frente, para a planilha não os interpretar como fórmula — os nomes vêm de um formulário público;
 *  - valores com vírgula, aspas ou quebra de linha vão entre aspas.
 */
export function campoDoCsv(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const seguro = /^[=+\-@\t\r\n]/.test(texto) ? `'${texto}` : texto;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

const DATA_DO_CSV = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** CSV dos contatos (UTF-8 com BOM, para o Excel abrir os acentos direito). */
export function gerarCsvDeContatos(lista: readonly ContatoNaLista[]): string {
  const linhas = lista.map((contato) =>
    [
      contato.loja,
      contato.nome,
      PAPEL_NO_PAINEL[contato.papel],
      quemDecide(contato),
      formatarWhatsApp(contato.whatsapp),
      // Só dígitos, com o 55 na frente: o formato dos links wa.me.
      contato.whatsapp.replace(/\D/g, ""),
      contato.ramo ? ROTULO_RAMO[contato.ramo] : "",
      contato.cartaoCodigo,
      contato.loteIdentificador ?? "",
      ROTULO_TIPO[contato.tipo],
      DATA_DO_CSV.format(contato.registradoEm).replace(",", ""),
      contato.aceitouOfertas ? "sim" : "não",
      ROTULO_SITUACAO[contato.situacao],
      contato.observacao ?? "",
      contato.cartoesDaLoja,
    ]
      .map(campoDoCsv)
      .join(","),
  );
  return `﻿${[COLUNAS_DO_CSV_DE_CONTATOS.join(","), ...linhas].join("\r\n")}\r\n`;
}
