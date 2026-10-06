// Lotes de fabricação: gera vários cartões de uma vez para enviar à gráfica.
import { desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { cartoes, lotes, type Cartao, type Lote } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { criarCartoes, TAMANHO_MAXIMO_DESCRICAO } from "@/modules/cards/servico";
import { TIPOS_DESTINO } from "@/modules/cards/tipos";

export const QUANTIDADE_MAXIMA_POR_LOTE = 1000;
const MAX_TENTATIVAS_DE_NUMERACAO = 3;

export const esquemaDeNovoLote = z.object({
  quantidade: z.coerce
    .number("Informe a quantidade.")
    .int("A quantidade deve ser um número inteiro.")
    .min(1, "A quantidade mínima é 1.")
    .max(QUANTIDADE_MAXIMA_POR_LOTE, `A quantidade máxima por lote é ${QUANTIDADE_MAXIMA_POR_LOTE}.`),
  /** null = cartões sem tipo definido. */
  tipo: z.enum(TIPOS_DESTINO).nullable(),
  descricao: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DESCRICAO, `A descrição deve ter no máximo ${TAMANHO_MAXIMO_DESCRICAO} caracteres.`)
    .transform((texto) => (texto.length > 0 ? texto : null))
    .nullable(),
});

export type NovoLote = z.infer<typeof esquemaDeNovoLote>;

export interface LoteComCartoes {
  lote: Lote;
  cartoes: Cartao[];
}

export interface OpcoesDeCriacao {
  agora?: Date;
  /** Gerador de códigos alternativo (usado nos testes). */
  gerarCodigo?: () => string;
}

export function identificadorDoLote(ano: number, sequencia: number): string {
  return `lote-${ano}-${String(sequencia).padStart(3, "0")}`;
}

function anoAtual(agora: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(agora),
  );
}

function violacaoDeUnicidade(erro: unknown): boolean {
  for (let atual: unknown = erro; atual instanceof Error; atual = atual.cause) {
    if ("code" in atual && atual.code === "23505") return true;
  }
  return false;
}

/**
 * Cria o lote e todos os seus cartões em uma única transação: ou tudo é criado, ou nada.
 * Os cartões nascem NAO_CONFIGURADO, já com a URL permanente definida pelo código.
 */
export async function criarLote(
  db: Banco,
  entrada: NovoLote,
  opcoes: OpcoesDeCriacao = {},
): Promise<LoteComCartoes> {
  const dados = esquemaDeNovoLote.parse(entrada);
  const ano = anoAtual(opcoes.agora ?? new Date());

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.transaction(async (tx) => {
        const [{ ultima }] = await tx
          .select({ ultima: max(lotes.sequencia) })
          .from(lotes)
          .where(eq(lotes.ano, ano));
        const sequencia = (ultima ?? 0) + 1;

        const [lote] = await tx
          .insert(lotes)
          .values({
            identificador: identificadorDoLote(ano, sequencia),
            ano,
            sequencia,
            quantidade: dados.quantidade,
            tipo: dados.tipo,
            descricao: dados.descricao,
          })
          .returning();

        const cartoes = await criarCartoes(
          tx,
          dados.quantidade,
          { tipo: dados.tipo, loteId: lote.id },
          opcoes.gerarCodigo,
        );
        return { lote, cartoes };
      });
    } catch (erro) {
      // Dois lotes criados no mesmo instante disputam o mesmo número: basta tentar de novo.
      if (violacaoDeUnicidade(erro) && tentativa < MAX_TENTATIVAS_DE_NUMERACAO) continue;
      throw erro;
    }
  }
}

export async function listarLotes(db: Banco): Promise<Lote[]> {
  return db.select().from(lotes).orderBy(desc(lotes.ano), desc(lotes.sequencia));
}

export async function buscarLotePorIdentificador(db: Banco, identificador: string): Promise<Lote> {
  const [lote] = await db.select().from(lotes).where(eq(lotes.identificador, identificador)).limit(1);
  if (!lote) throw new ErroDeDominio("LOTE_NAO_ENCONTRADO", "Lote não encontrado.");
  return lote;
}

export async function buscarLotePorId(db: Banco, id: string): Promise<Lote | null> {
  const [lote] = await db.select().from(lotes).where(eq(lotes.id, id)).limit(1);
  return lote ?? null;
}

export interface LoteExcluido {
  identificador: string;
  cartoesExcluidos: number;
}

/**
 * Apaga o lote e TODOS os seus cartões, em uma única transação. É irreversível: os QR Codes e os
 * chips NFC desses cartões deixam de funcionar (a URL permanente passa a responder 404).
 * Como proteção contra engano, exige que o identificador do lote seja digitado como confirmação.
 */
export async function excluirLote(
  db: Banco,
  identificador: string,
  confirmacao: string,
): Promise<LoteExcluido> {
  if (confirmacao.trim() !== identificador) {
    throw new ErroDeDominio(
      "ENTRADA_INVALIDA",
      `Para confirmar, digite o identificador do lote exatamente como aparece: ${identificador}`,
    );
  }
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.identificador, identificador)).for("update");
    if (!lote) throw new ErroDeDominio("LOTE_NAO_ENCONTRADO", "Lote não encontrado.");

    const excluidos = await tx.delete(cartoes).where(eq(cartoes.loteId, lote.id)).returning({ id: cartoes.id });
    await tx.delete(lotes).where(eq(lotes.id, lote.id));
    return { identificador: lote.identificador, cartoesExcluidos: excluidos.length };
  });
}
