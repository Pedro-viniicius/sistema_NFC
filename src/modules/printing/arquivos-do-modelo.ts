// Acesso aos arquivos estáticos de impressão (pasta templates/ do repositório).
// São arquivos somente leitura, empacotados junto com a função na Vercel
// (ver outputFileTracingIncludes em next.config.ts). Nada é gravado em disco.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ErroDeDominio } from "@/lib/erros";
import glifosDoCodigo from "../../../templates/glifos-do-codigo.json";
import type { ModeloDeImpressao } from "./modelos";
import type { TabelaDeGlifos } from "./texto-em-curvas";

export const PASTA_DOS_MODELOS = "templates";

/** Contornos das letras do código do cartão (gerados por `pnpm impressao:modelos`). */
export const GLIFOS_DO_CODIGO: TabelaDeGlifos = glifosDoCodigo;

const artesCarregadas = new Map<string, Promise<Uint8Array>>();

async function lerArte(arquivo: string): Promise<Uint8Array> {
  try {
    return await readFile(path.join(process.cwd(), PASTA_DOS_MODELOS, arquivo));
  } catch {
    throw new ErroDeDominio(
      "MODELO_NAO_ENCONTRADO",
      `O arquivo de arte ${PASTA_DOS_MODELOS}/${arquivo} não foi encontrado.`,
    );
  }
}

/** Bytes do PDF de arte fixa do modelo. Fica em memória depois da primeira leitura. */
export function carregarArteDoModelo(modelo: ModeloDeImpressao): Promise<Uint8Array> {
  let arte = artesCarregadas.get(modelo.arquivo);
  if (!arte) {
    arte = lerArte(modelo.arquivo);
    artesCarregadas.set(modelo.arquivo, arte);
    // Uma falha não fica em cache: a próxima chamada tenta ler de novo.
    arte.catch(() => artesCarregadas.delete(modelo.arquivo));
  }
  return arte;
}
