import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { obterDatabaseUrl } from "@/lib/env";
import { registrarLog } from "@/lib/log";
import * as schema from "./schema";
import type { Banco } from "./tipos";

// Guardado em globalThis para sobreviver ao hot reload do `next dev`
// e ser reaproveitado entre requisições na mesma instância da Vercel.
const global = globalThis as typeof globalThis & { __bancoNfc?: Banco };

function criarBanco(): Banco {
  const pool = new Pool({
    connectionString: obterDatabaseUrl(),
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (erro) => {
    registrarLog("erro", "banco.pool", { mensagem: erro.message });
  });
  // Na Vercel (Fluid Compute), fecha conexões ociosas antes de a instância ser suspensa.
  attachDatabasePool(pool);
  return drizzle(pool, { schema });
}

export function obterBanco(): Banco {
  global.__bancoNfc ??= criarBanco();
  return global.__bancoNfc;
}
