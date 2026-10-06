import { sql } from "drizzle-orm";
import {
  check,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
// Import relativo de propósito: o drizzle-kit não resolve o alias "@/".
import type { StatusCartao, TipoDestino } from "../modules/cards/tipos";

const dataHora = (nome: string) => timestamp(nome, { withTimezone: true });

/** Lote de fabricação: um conjunto de cartões gerados de uma vez para impressão. */
export const lotes = pgTable(
  "lotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nome legível e estável, ex.: lote-2026-001. */
    identificador: text("identificador").notNull().unique(),
    ano: integer("ano").notNull(),
    sequencia: integer("sequencia").notNull(),
    quantidade: integer("quantidade").notNull(),
    /** Tipo pré-definido para os cartões do lote; nulo = sem tipo definido. */
    tipo: text("tipo").$type<TipoDestino>(),
    descricao: text("descricao"),
    criadoEm: dataHora("criado_em").notNull().defaultNow(),
  },
  (t) => [
    unique("lotes_ano_sequencia_unico").on(t.ano, t.sequencia),
    check("lotes_quantidade_positiva", sql`${t.quantidade} > 0`),
    check(
      "lotes_tipo_valido",
      sql`${t.tipo} is null or ${t.tipo} in ('INSTAGRAM', 'GOOGLE', 'GENERICO')`,
    ),
  ],
);

/** Cartão físico (NFC + QR). O `codigo` é permanente: nunca muda depois de criado. */
export const cartoes = pgTable(
  "cartoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Código público permanente, impresso no QR e gravado no NFC (via URL permanente). */
    codigo: text("codigo").notNull().unique(),
    tipo: text("tipo").$type<TipoDestino>(),
    /** Destino atual do redirecionamento. É o único dado que muda ao reconfigurar o cartão. */
    destinoUrl: text("destino_url"),
    status: text("status").$type<StatusCartao>().notNull().default("NAO_CONFIGURADO"),
    descricao: text("descricao"),
    loteId: uuid("lote_id").references(() => lotes.id, { onDelete: "restrict" }),
    totalAcessos: integer("total_acessos").notNull().default(0),
    ultimoAcessoEm: dataHora("ultimo_acesso_em"),
    criadoEm: dataHora("criado_em").notNull().defaultNow(),
    atualizadoEm: dataHora("atualizado_em").notNull().defaultNow(),
    /** Data da primeira ativação (primeira vez que recebeu um destino). */
    ativadoEm: dataHora("ativado_em"),
  },
  (t) => [
    // Mesmo alfabeto de src/modules/cards/codigo.ts (sem 0, O, 1, I, L).
    check("cartoes_codigo_formato", sql`${t.codigo} ~ '^[2-9A-HJKMNP-Z]{6}$'`),
    check("cartoes_status_valido", sql`${t.status} in ('NAO_CONFIGURADO', 'ATIVO', 'INATIVO')`),
    check(
      "cartoes_tipo_valido",
      sql`${t.tipo} is null or ${t.tipo} in ('INSTAGRAM', 'GOOGLE', 'GENERICO')`,
    ),
    // Um cartão ativo sempre tem destino e tipo; um não configurado nunca tem destino.
    check(
      "cartoes_ativo_tem_destino",
      sql`${t.status} <> 'ATIVO' or (${t.destinoUrl} is not null and ${t.tipo} is not null)`,
    ),
    check(
      "cartoes_nao_configurado_sem_destino",
      sql`${t.status} <> 'NAO_CONFIGURADO' or ${t.destinoUrl} is null`,
    ),
    index("cartoes_status_idx").on(t.status),
    index("cartoes_lote_idx").on(t.loteId),
    index("cartoes_criado_em_idx").on(t.criadoEm),
  ],
);

/** Administradores do painel. Hoje há um só, mas a tabela já comporta vários. */
export const administradores = pgTable("administradores", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Sempre em minúsculas. */
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  tentativasFalhas: integer("tentativas_falhas").notNull().default(0),
  bloqueadoAte: dataHora("bloqueado_ate"),
  criadoEm: dataHora("criado_em").notNull().defaultNow(),
});

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (valor) => Buffer.from(valor),
});

/**
 * Arte de impressão enviada pelo painel, uma por modelo. Substitui a arte padrão de templates/.
 * Fica no banco porque a Vercel não tem disco persistente. Sem linha para o tipo = arte padrão.
 */
export const artesDeImpressao = pgTable(
  "artes_de_impressao",
  {
    tipo: text("tipo").$type<TipoDestino>().primaryKey(),
    /** PDF de uma página com a arte fixa. */
    pdf: bytea("pdf").notNull(),
    nomeDoArquivo: text("nome_do_arquivo").notNull(),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    /** Área do QR (com zona de silêncio), em mm a partir do canto superior esquerdo do corte. */
    qrXMm: doublePrecision("qr_x_mm").notNull(),
    qrYMm: doublePrecision("qr_y_mm").notNull(),
    qrTamanhoMm: doublePrecision("qr_tamanho_mm").notNull(),
    /** Cor do código impresso abaixo do QR; nulo = não imprimir o código. */
    corDoCodigo: text("cor_do_codigo").$type<"preto" | "branco">(),
    enviadoEm: dataHora("enviado_em").notNull().defaultNow(),
  },
  (t) => [
    check("artes_tipo_com_modelo", sql`${t.tipo} in ('GOOGLE', 'INSTAGRAM')`),
    check("artes_cor_do_codigo_valida", sql`${t.corDoCodigo} is null or ${t.corDoCodigo} in ('preto', 'branco')`),
    check("artes_qr_tamanho_positivo", sql`${t.qrTamanhoMm} > 0`),
  ],
);

export type Cartao = typeof cartoes.$inferSelect;
export type Lote = typeof lotes.$inferSelect;
export type Administrador = typeof administradores.$inferSelect;
export type ArteDeImpressao = typeof artesDeImpressao.$inferSelect;
