// Armazenamento em disco local. SOMENTE para desenvolvimento: a Vercel não tem disco persistente,
// então esta implementação se recusa a existir lá (ver modoDeArmazenamento em ./index).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ErroDeArmazenamento,
  ErroDeArquivoGrandeDemais,
  exigirChaveValida,
  type ArmazenamentoDeArquivos,
  type OpcoesDeLeitura,
} from "./tipos";

function arquivoInexistente(erro: unknown): boolean {
  return erro instanceof Error && "code" in erro && erro.code === "ENOENT";
}

export class ArmazenamentoLocal implements ArmazenamentoDeArquivos {
  constructor(private readonly pasta: string) {
    if (process.env.VERCEL || process.env.VERCEL_ENV) {
      throw new ErroDeArmazenamento("O armazenamento em disco local não pode ser usado na Vercel.");
    }
  }

  private caminho(chave: string): string {
    return path.join(this.pasta, ...exigirChaveValida(chave).split("/"));
  }

  async salvar(chave: string, conteudo: Uint8Array): Promise<void> {
    const destino = this.caminho(chave);
    await mkdir(path.dirname(destino), { recursive: true });
    try {
      // "wx": falha se o arquivo já existir, em vez de sobrescrever.
      await writeFile(destino, conteudo, { flag: "wx" });
    } catch (erro) {
      if (erro instanceof Error && "code" in erro && erro.code === "EEXIST") {
        throw new ErroDeArmazenamento("Já existe um arquivo com esta chave.");
      }
      throw erro;
    }
  }

  async ler(chave: string, opcoes: OpcoesDeLeitura = {}): Promise<Uint8Array | null> {
    const origem = this.caminho(chave);
    try {
      if (opcoes.limiteBytes !== undefined && (await stat(origem)).size > opcoes.limiteBytes) {
        throw new ErroDeArquivoGrandeDemais(opcoes.limiteBytes);
      }
      return new Uint8Array(await readFile(origem));
    } catch (erro) {
      if (arquivoInexistente(erro)) return null;
      throw erro;
    }
  }

  async excluir(chave: string): Promise<void> {
    await rm(this.caminho(chave), { force: true });
  }

  async existe(chave: string): Promise<boolean> {
    try {
      return (await stat(this.caminho(chave))).isFile();
    } catch (erro) {
      if (arquivoInexistente(erro)) return false;
      throw erro;
    }
  }
}
