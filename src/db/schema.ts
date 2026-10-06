import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Imports relativos de propósito: o drizzle-kit não resolve o alias "@/".
import type { StatusCartao, TipoDestino } from "../modules/cards/tipos";
import type { Papel, Ramo, SituacaoDoContato } from "../modules/contacts/tipos";
import type { CaixaPt, StatusTemplate } from "../modules/templates/tipos";

const dataHora = (nome: string) => timestamp(nome, { withTimezone: true });

/**
 * Template de impressão: a arte final em PDF enviada pelo painel, mais a área onde entra o QR.
 * O arquivo fica no armazenamento persistente (Vercel Blob); aqui ficam os metadados e a referência.
 * Um arquivo armazenado nunca é sobrescrito, e um template usado por um lote fica bloqueado.
 */
export const templatesDeImpressao = pgTable(
  "templates_de_impressao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    /** Produto a que a arte se destina. Nulo só enquanto o rascunho ainda não foi classificado. */
    tipo: text("tipo").$type<TipoDestino>(),
    status: text("status").$type<StatusTemplate>().notNull().default("RASCUNHO"),
    /** Template sugerido para novos lotes do produto. No máximo um por produto. */
    padrao: boolean("padrao").notNull().default(false),
    /** Referência do arquivo no armazenamento persistente (nunca um caminho de disco). */
    chaveDoArquivo: text("chave_do_arquivo").notNull().unique(),
    arquivoNomeOriginal: text("arquivo_nome_original").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    sha256: text("sha256").notNull(),
    numeroDePaginas: integer("numero_de_paginas").notNull(),
    rotacao: integer("rotacao").notNull(),
    /** Caixas da página em pontos: [x0, y0, x1, y1], origem embaixo à esquerda. */
    mediaBox: jsonb("media_box").$type<CaixaPt>().notNull(),
    cropBox: jsonb("crop_box").$type<CaixaPt>().notNull(),
    trimBox: jsonb("trim_box").$type<CaixaPt>(),
    bleedBox: jsonb("bleed_box").$type<CaixaPt>(),
    /** Tamanho da página visível (CropBox limitada à MediaBox), em mm. */
    larguraDaPaginaMm: doublePrecision("largura_da_pagina_mm").notNull(),
    alturaDaPaginaMm: doublePrecision("altura_da_pagina_mm").notNull(),
    /** Área do QR em pontos, no espaço do usuário da página (origem embaixo à esquerda). */
    qrXPt: doublePrecision("qr_x_pt"),
    qrYPt: doublePrecision("qr_y_pt"),
    qrLarguraPt: doublePrecision("qr_largura_pt"),
    qrAlturaPt: doublePrecision("qr_altura_pt"),
    qrZonaDeSilencioModulos: integer("qr_zona_de_silencio_modulos").notNull().default(4),
    /** Última alteração da área do QR. O teste só vale se for posterior a esta data. */
    qrConfiguradoEm: dataHora("qr_configurado_em"),
    /** Último teste bem-sucedido no servidor; volta a nulo quando a área do QR muda. */
    qrTestadoEm: dataHora("qr_testado_em"),
    /** Preenchido quando o primeiro lote usa o template: arquivo e área do QR não mudam mais. */
    bloqueadoEm: dataHora("bloqueado_em"),
    criadoEm: dataHora("criado_em").notNull().defaultNow(),
    atualizadoEm: dataHora("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    check("templates_status_valido", sql`${t.status} in ('RASCUNHO', 'PRONTO', 'INATIVO')`),
    check(
      "templates_tipo_valido",
      sql`${t.tipo} is null or ${t.tipo} in ('INSTAGRAM', 'GOOGLE', 'GENERICO')`,
    ),
    check("templates_uma_pagina_sem_rotacao", sql`${t.numeroDePaginas} = 1 and ${t.rotacao} = 0`),
    check("templates_zona_de_silencio_minima", sql`${t.qrZonaDeSilencioModulos} >= 2`),
    // A área do QR ou está toda definida (com tamanho positivo) ou não está definida.
    check(
      "templates_area_do_qr_completa",
      sql`(${t.qrXPt} is null and ${t.qrYPt} is null and ${t.qrLarguraPt} is null and ${t.qrAlturaPt} is null)
        or (${t.qrXPt} is not null and ${t.qrYPt} is not null and ${t.qrLarguraPt} > 0 and ${t.qrAlturaPt} > 0)`,
    ),
    // PRONTO exige produto, área do QR e um teste posterior à última alteração da área.
    check(
      "templates_pronto_exige_qr_testado",
      sql`${t.status} <> 'PRONTO' or (
        ${t.tipo} is not null and ${t.qrXPt} is not null
        and ${t.qrTestadoEm} is not null and ${t.qrConfiguradoEm} is not null
        and ${t.qrTestadoEm} >= ${t.qrConfiguradoEm}
      )`,
    ),
    check("templates_padrao_exige_pronto", sql`not ${t.padrao} or ${t.status} = 'PRONTO'`),
    uniqueIndex("templates_um_padrao_por_tipo").on(t.tipo).where(sql`${t.padrao}`),
    index("templates_tipo_status_idx").on(t.tipo, t.status),
  ],
);

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
    /**
     * Template de impressão com que o lote foi gerado, e o SHA-256 do arquivo naquele momento.
     * Nulo nos lotes anteriores aos templates: esses seguem pelo caminho antigo (modelo do sistema).
     */
    templateId: uuid("template_id").references(() => templatesDeImpressao.id, { onDelete: "restrict" }),
    templateSha256: text("template_sha256"),
    /**
     * "Ativação pelo cliente": quando ligada, quem abre a URL de um cartão NÃO configurado deste lote
     * vê o passo a passo para ativá-lo sozinho. Deve ser ligada só quando os cartões saem para entrega.
     */
    ativacaoPeloCliente: boolean("ativacao_pelo_cliente").notNull().default(false),
    criadoEm: dataHora("criado_em").notNull().defaultNow(),
  },
  (t) => [
    unique("lotes_ano_sequencia_unico").on(t.ano, t.sequencia),
    check(
      "lotes_template_com_sha256",
      sql`(${t.templateId} is null) = (${t.templateSha256} is null)`,
    ),
    index("lotes_template_idx").on(t.templateId),
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

/**
 * Contato de quem ativou um cartão pela página pública. É uma oportunidade de venda e, ao mesmo
 * tempo, um dado pessoal: pode ser excluído a pedido do titular sem afetar o cartão.
 */
export const contatos = pgTable(
  "contatos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Cartão ativado. Vira nulo se o cartão for apagado (o contato continua existindo). */
    cartaoId: uuid("cartao_id")
      .unique()
      .references(() => cartoes.id, { onDelete: "set null" }),
    /** Retrato do cartão no momento da ativação: código, lote e tipo não mudam depois. */
    cartaoCodigo: text("cartao_codigo").notNull(),
    loteIdentificador: text("lote_identificador"),
    tipo: text("tipo").$type<TipoDestino>().notNull(),
    loja: text("loja").notNull(),
    ramo: text("ramo").$type<Ramo>(),
    nome: text("nome").notNull(),
    papel: text("papel").$type<Papel>().notNull(),
    /** Quem decide as coisas na loja, quando não é a própria pessoa que preencheu. */
    decisor: text("decisor"),
    /** Sempre no formato internacional: +55 + DDD + número. */
    whatsapp: text("whatsapp").notNull(),
    /** Aceite (opcional) de receber ofertas, com a versão do texto de privacidade exibido e a data. */
    aceitouOfertas: boolean("aceitou_ofertas").notNull(),
    versaoDoTexto: text("versao_do_texto").notNull(),
    registradoEm: dataHora("registrado_em").notNull().defaultNow(),
    situacao: text("situacao").$type<SituacaoDoContato>().notNull().default("NOVO"),
    observacao: text("observacao"),
    atualizadoEm: dataHora("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    check("contatos_whatsapp_formato", sql`${t.whatsapp} ~ '^\\+55[1-9][0-9]{9,10}$'`),
    check(
      "contatos_situacao_valida",
      sql`${t.situacao} in ('NOVO', 'CONVERSANDO', 'CLIENTE', 'SEM_INTERESSE')`,
    ),
    check("contatos_papel_valido", sql`${t.papel} in ('DONO', 'GERENTE', 'FUNCIONARIO', 'OUTRO')`),
    check(
      "contatos_ramo_valido",
      sql`${t.ramo} is null or ${t.ramo} in ('RESTAURANTE', 'BELEZA', 'VAREJO', 'SAUDE', 'SERVICOS', 'OUTRO')`,
    ),
    check("contatos_tipo_valido", sql`${t.tipo} in ('INSTAGRAM', 'GOOGLE', 'GENERICO')`),
    index("contatos_whatsapp_idx").on(t.whatsapp),
    index("contatos_situacao_idx").on(t.situacao),
    index("contatos_registrado_em_idx").on(t.registradoEm),
  ],
);

/**
 * Contadores do limite de tentativas da página pública. Ficam no banco porque, na Vercel, cada
 * requisição pode cair em uma instância diferente: um contador em memória não funcionaria.
 * A chave nunca contém o IP em claro (só um resumo com segredo).
 */
export const limitesDeTentativas = pgTable(
  "limites_de_tentativas",
  {
    chave: text("chave").primaryKey(),
    contagem: integer("contagem").notNull(),
    /** Início da janela de contagem atual. */
    inicio: dataHora("inicio").notNull(),
    /** Fim da janela: depois disto a linha pode ser apagada. */
    expiraEm: dataHora("expira_em").notNull(),
  },
  (t) => [index("limites_expira_em_idx").on(t.expiraEm)],
);

export type Cartao = typeof cartoes.$inferSelect;
export type Contato = typeof contatos.$inferSelect;
export type Lote = typeof lotes.$inferSelect;
export type Administrador = typeof administradores.$inferSelect;
export type ArteDeImpressao = typeof artesDeImpressao.$inferSelect;
export type TemplateDeImpressao = typeof templatesDeImpressao.$inferSelect;
