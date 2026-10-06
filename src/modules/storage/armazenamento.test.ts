import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErroDeConfiguracao } from "@/lib/env";
import { modoDeArmazenamento } from "./index";
import { ArmazenamentoLocal } from "./local";
import { ArmazenamentoEmMemoria } from "./memoria";
import { ErroDeArmazenamento, ErroDeArquivoGrandeDemais, type ArmazenamentoDeArquivos } from "./tipos";

const PDF = new TextEncoder().encode("%PDF-1.7 conteúdo de teste");
let pasta: string;

beforeAll(async () => {
  pasta = await mkdtemp(path.join(tmpdir(), "nfc-armazenamento-"));
});

afterAll(async () => {
  await rm(pasta, { recursive: true, force: true });
});

const implementacoes: [string, () => ArmazenamentoDeArquivos][] = [
  ["memória", () => new ArmazenamentoEmMemoria()],
  ["disco local", () => new ArmazenamentoLocal(pasta)],
];

describe.each(implementacoes)("armazenamento em %s", (_nome, criar) => {
  it("grava, lê, confere a existência e exclui", async () => {
    const armazenamento = criar();
    const chave = "templates-impressao/arte-a.pdf";
    expect(await armazenamento.existe(chave)).toBe(false);
    expect(await armazenamento.ler(chave)).toBeNull();

    await armazenamento.salvar(chave, PDF, "application/pdf");
    expect(await armazenamento.existe(chave)).toBe(true);
    expect(await armazenamento.ler(chave)).toEqual(PDF);

    await armazenamento.excluir(chave);
    expect(await armazenamento.existe(chave)).toBe(false);
    // Excluir de novo não é erro.
    await armazenamento.excluir(chave);
  });

  it("nunca sobrescreve um arquivo existente", async () => {
    const armazenamento = criar();
    const chave = "templates-impressao/arte-b.pdf";
    await armazenamento.salvar(chave, PDF, "application/pdf");
    await expect(armazenamento.salvar(chave, new Uint8Array([1, 2, 3]), "application/pdf")).rejects.toThrow(
      ErroDeArmazenamento,
    );
    expect(await armazenamento.ler(chave)).toEqual(PDF);
  });

  it("interrompe a leitura de um arquivo maior que o limite", async () => {
    const armazenamento = criar();
    const chave = "templates-impressao/arte-c.pdf";
    await armazenamento.salvar(chave, PDF, "application/pdf");
    await expect(armazenamento.ler(chave, { limiteBytes: 5 })).rejects.toThrow(ErroDeArquivoGrandeDemais);
    expect(await armazenamento.ler(chave, { limiteBytes: PDF.length })).toEqual(PDF);
  });

  it("recusa chaves que sairiam da pasta", async () => {
    const armazenamento = criar();
    for (const chave of ["../segredo.pdf", "/etc/passwd", "a/../../b.pdf", "a//b.pdf", "", "a b.pdf"]) {
      await expect(armazenamento.ler(chave)).rejects.toThrow(ErroDeArmazenamento);
      await expect(armazenamento.salvar(chave, PDF, "application/pdf")).rejects.toThrow(ErroDeArmazenamento);
    }
  });
});

describe("escolha do armazenamento", () => {
  const env = (valores: Record<string, string>) => valores as unknown as NodeJS.ProcessEnv;

  it("usa o Vercel Blob quando há token", () => {
    expect(modoDeArmazenamento(env({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", VERCEL: "1" }))).toBe("vercel-blob");
    expect(modoDeArmazenamento(env({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", NODE_ENV: "development" }))).toBe(
      "vercel-blob",
    );
  });

  it("usa o disco local só em desenvolvimento, ou quando pedido explicitamente fora da Vercel", () => {
    expect(modoDeArmazenamento(env({ NODE_ENV: "development" }))).toBe("local");
    expect(modoDeArmazenamento(env({ NODE_ENV: "production", ARMAZENAMENTO_LOCAL: "1" }))).toBe("local");
    expect(() => modoDeArmazenamento(env({ NODE_ENV: "production" }))).toThrow(ErroDeConfiguracao);
  });

  it("na Vercel, nunca usa o disco local", () => {
    expect(() => modoDeArmazenamento(env({ VERCEL: "1", NODE_ENV: "production" }))).toThrow(ErroDeConfiguracao);
    expect(() => modoDeArmazenamento(env({ VERCEL: "1", ARMAZENAMENTO_LOCAL: "1" }))).toThrow(ErroDeConfiguracao);
    expect(() => modoDeArmazenamento(env({ VERCEL_ENV: "preview", NODE_ENV: "development" }))).toThrow(
      ErroDeConfiguracao,
    );
  });

  it("o armazenamento local se recusa a ser criado na Vercel", () => {
    const anterior = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(() => new ArmazenamentoLocal(pasta)).toThrow(ErroDeArmazenamento);
    } finally {
      if (anterior === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = anterior;
    }
  });
});
