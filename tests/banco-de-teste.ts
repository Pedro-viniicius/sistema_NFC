import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Banco } from "@/db/tipos";

/** Postgres em memória com as migrações reais aplicadas. Um banco novo por arquivo de teste. */
export async function criarBancoDeTeste(): Promise<Banco> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
