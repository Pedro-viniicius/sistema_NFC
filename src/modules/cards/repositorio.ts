// Consultas de cartões (somente leitura, mais o contador de acessos).
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { cartoes, type Cartao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import type { StatusCartao, TipoDestino } from "./tipos";

export async function buscarCartaoPorCodigo(db: Banco, codigo: string): Promise<Cartao | null> {
  const [cartao] = await db.select().from(cartoes).where(eq(cartoes.codigo, codigo)).limit(1);
  return cartao ?? null;
}

export interface DadosParaRedirecionar {
  id: string;
  status: StatusCartao;
  destinoUrl: string | null;
}

/** Consulta mínima usada pela rota pública: só as colunas necessárias para redirecionar. */
export async function buscarParaRedirecionar(
  db: Banco,
  codigo: string,
): Promise<DadosParaRedirecionar | null> {
  const [linha] = await db
    .select({ id: cartoes.id, status: cartoes.status, destinoUrl: cartoes.destinoUrl })
    .from(cartoes)
    .where(eq(cartoes.codigo, codigo))
    .limit(1);
  return linha ?? null;
}

/** Estatística simples e sem dados pessoais: total de acessos e data do último. */
export async function registrarAcesso(db: Banco, cartaoId: string): Promise<void> {
  await db
    .update(cartoes)
    .set({ totalAcessos: sql`${cartoes.totalAcessos} + 1`, ultimoAcessoEm: new Date() })
    .where(eq(cartoes.id, cartaoId));
}

export interface FiltroCartoes {
  busca?: string;
  status?: StatusCartao;
  tipo?: TipoDestino;
  pagina?: number;
  porPagina?: number;
}

export interface PaginaDeCartoes {
  itens: Cartao[];
  total: number;
  pagina: number;
  porPagina: number;
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

export async function listarCartoes(db: Banco, filtro: FiltroCartoes = {}): Promise<PaginaDeCartoes> {
  const porPagina = Math.min(Math.max(filtro.porPagina ?? 50, 1), 200);
  const pagina = Math.max(filtro.pagina ?? 1, 1);

  const condicoes: SQL[] = [];
  if (filtro.status) condicoes.push(eq(cartoes.status, filtro.status));
  if (filtro.tipo) condicoes.push(eq(cartoes.tipo, filtro.tipo));
  const busca = filtro.busca?.trim();
  if (busca) {
    const padrao = `%${escaparLike(busca)}%`;
    const porTexto = or(
      ilike(cartoes.codigo, padrao),
      ilike(cartoes.destinoUrl, padrao),
      ilike(cartoes.descricao, padrao),
    );
    if (porTexto) condicoes.push(porTexto);
  }
  const onde = condicoes.length > 0 ? and(...condicoes) : undefined;

  const [itens, [contagem]] = await Promise.all([
    db
      .select()
      .from(cartoes)
      .where(onde)
      .orderBy(desc(cartoes.criadoEm), cartoes.codigo)
      .limit(porPagina)
      .offset((pagina - 1) * porPagina),
    db.select({ total: count() }).from(cartoes).where(onde),
  ]);

  return { itens, total: contagem?.total ?? 0, pagina, porPagina };
}

export async function listarCartoesDoLote(db: Banco, loteId: string): Promise<Cartao[]> {
  return db.select().from(cartoes).where(eq(cartoes.loteId, loteId)).orderBy(cartoes.codigo);
}

export interface EstatisticasDeCartoes {
  total: number;
  naoConfigurados: number;
  ativos: number;
  inativos: number;
  instagram: number;
  google: number;
}

export async function obterEstatisticas(db: Banco): Promise<EstatisticasDeCartoes> {
  const contarSe = (condicao: SQL) => sql<number>`count(*) filter (where ${condicao})::int`;
  const [linha] = await db
    .select({
      total: sql<number>`count(*)::int`,
      naoConfigurados: contarSe(eq(cartoes.status, "NAO_CONFIGURADO")),
      ativos: contarSe(eq(cartoes.status, "ATIVO")),
      inativos: contarSe(eq(cartoes.status, "INATIVO")),
      instagram: contarSe(eq(cartoes.tipo, "INSTAGRAM")),
      google: contarSe(eq(cartoes.tipo, "GOOGLE")),
    })
    .from(cartoes);
  return linha ?? { total: 0, naoConfigurados: 0, ativos: 0, inativos: 0, instagram: 0, google: 0 };
}
