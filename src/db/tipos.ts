import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Esquema = typeof schema;

/**
 * Conexão com o banco independente de driver. Em produção é o `pg` (Neon/Postgres);
 * nos testes é o PGlite. Uma transação também satisfaz este tipo.
 */
export type Banco = PgDatabase<PgQueryResultHKT, Esquema>;
