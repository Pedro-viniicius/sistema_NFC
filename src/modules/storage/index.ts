// Escolhe o armazenamento de arquivos do ambiente. Somente servidor.
import "server-only";
import path from "node:path";
import { ErroDeConfiguracao } from "@/lib/env";
import { ArmazenamentoLocal } from "./local";
import type { ArmazenamentoDeArquivos } from "./tipos";
import { ArmazenamentoVercelBlob } from "./vercel-blob";

export type ModoDeArmazenamento = "vercel-blob" | "local";

/** Pasta do armazenamento local de desenvolvimento (fora do Git). */
export const PASTA_DO_ARMAZENAMENTO_LOCAL = ".armazenamento-local";

/**
 * - Com BLOB_READ_WRITE_TOKEN: Vercel Blob (é o caso de produção e de preview).
 * - Na Vercel sem o token: erro de configuração. O disco de lá não é persistente, então o
 *   armazenamento local NUNCA é usado em produção.
 * - Fora da Vercel sem o token: disco local, só em desenvolvimento (`next dev`) ou quando pedido
 *   explicitamente com ARMAZENAMENTO_LOCAL=1 (para testar o build de produção na própria máquina).
 */
export function modoDeArmazenamento(ambiente: NodeJS.ProcessEnv = process.env): ModoDeArmazenamento {
  if (ambiente.BLOB_READ_WRITE_TOKEN?.trim()) return "vercel-blob";
  if (ambiente.VERCEL || ambiente.VERCEL_ENV) {
    throw new ErroDeConfiguracao(
      "O armazenamento de arquivos não está configurado: conecte um Blob store ao projeto na Vercel (variável BLOB_READ_WRITE_TOKEN).",
    );
  }
  if (ambiente.NODE_ENV !== "production" || ambiente.ARMAZENAMENTO_LOCAL === "1") return "local";
  throw new ErroDeConfiguracao(
    "O armazenamento de arquivos não está configurado: defina BLOB_READ_WRITE_TOKEN (Vercel Blob).",
  );
}

const global = globalThis as typeof globalThis & { __armazenamentoNfc?: ArmazenamentoDeArquivos };

export function obterArmazenamento(): ArmazenamentoDeArquivos {
  global.__armazenamentoNfc ??=
    modoDeArmazenamento() === "vercel-blob"
      ? new ArmazenamentoVercelBlob()
      : new ArmazenamentoLocal(path.join(process.cwd(), PASTA_DO_ARMAZENAMENTO_LOCAL));
  return global.__armazenamentoNfc;
}
