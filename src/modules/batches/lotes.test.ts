import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { Banco } from "@/db/tipos";
import { codigoValido } from "@/modules/cards/codigo";
import { listarCartoes, listarCartoesDoLote } from "@/modules/cards/repositorio";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { gerarCsvDoLote, gerarZipDoLote } from "./exportacao";
import {
  QUANTIDADE_MAXIMA_POR_LOTE,
  buscarLotePorIdentificador,
  criarLote,
  esquemaDeNovoLote,
  listarLotes,
} from "./servico";

let db: Banco;
const em2026 = { agora: new Date("2026-03-15T15:00:00Z") };

beforeAll(async () => {
  db = await criarBancoDeTeste();
});

describe("criação de lote", () => {
  it("cria a quantidade pedida de cartões, todos com código único e não configurados", async () => {
    const { lote, cartoes } = await criarLote(
      db,
      { quantidade: 100, tipo: "INSTAGRAM", descricao: null },
      em2026,
    );
    expect(lote.identificador).toBe("lote-2026-001");
    expect(lote.quantidade).toBe(100);
    expect(cartoes).toHaveLength(100);
    expect(new Set(cartoes.map((c) => c.codigo)).size).toBe(100);
    for (const cartao of cartoes) {
      expect(codigoValido(cartao.codigo)).toBe(true);
      expect(cartao.status).toBe("NAO_CONFIGURADO");
      expect(cartao.tipo).toBe("INSTAGRAM");
      expect(cartao.destinoUrl).toBeNull();
      expect(cartao.loteId).toBe(lote.id);
    }
    expect(await listarCartoesDoLote(db, lote.id)).toHaveLength(100);
  });

  it("numera os lotes em sequência dentro do ano", async () => {
    const segundo = await criarLote(db, { quantidade: 2, tipo: null, descricao: "Teste" }, em2026);
    const de2027 = await criarLote(
      db,
      { quantidade: 1, tipo: "GOOGLE", descricao: null },
      { agora: new Date("2027-01-05T15:00:00Z") },
    );
    expect(segundo.lote.identificador).toBe("lote-2026-002");
    expect(segundo.lote.tipo).toBeNull();
    expect(segundo.cartoes.every((c) => c.tipo === null)).toBe(true);
    expect(de2027.lote.identificador).toBe("lote-2027-001");
    expect((await listarLotes(db)).map((l) => l.identificador)).toEqual([
      "lote-2027-001",
      "lote-2026-002",
      "lote-2026-001",
    ]);
  });

  it("valida a quantidade e o tipo", () => {
    const validar = (quantidade: unknown, tipo: unknown = null) =>
      esquemaDeNovoLote.safeParse({ quantidade, tipo, descricao: null }).success;
    expect(validar("100")).toBe(true);
    expect(validar(0)).toBe(false);
    expect(validar(-5)).toBe(false);
    expect(validar(1.5)).toBe(false);
    expect(validar("abc")).toBe(false);
    expect(validar(QUANTIDADE_MAXIMA_POR_LOTE + 1)).toBe(false);
    expect(validar(10, "TIKTOK")).toBe(false);
  });

  it("não deixa lote pela metade quando a criação falha", async () => {
    const antes = (await listarCartoes(db)).total;
    // O gerador sempre devolve o mesmo código: o 1º cartão entra, os demais nunca ficam únicos.
    await expect(
      criarLote(db, { quantidade: 3, tipo: null, descricao: null }, { ...em2026, gerarCodigo: () => "REPETE" }),
    ).rejects.toThrow("códigos únicos");
    expect((await listarCartoes(db)).total).toBe(antes);
    expect(await listarLotes(db)).toHaveLength(3);
  });

  it("informa quando o lote não existe", async () => {
    await expect(buscarLotePorIdentificador(db, "lote-1999-001")).rejects.toThrow("Lote não encontrado");
  });
});

describe("exportação para a gráfica", () => {
  it("gera CSV com código, URL permanente, tipo e arquivo de QR", async () => {
    const { cartoes } = await criarLote(db, { quantidade: 3, tipo: "GOOGLE", descricao: null }, em2026);
    const linhas = gerarCsvDoLote(cartoes).trimEnd().split("\r\n");
    expect(linhas[0]).toBe("codigo,url,tipo,arquivo_qr");
    expect(linhas).toHaveLength(4);
    const [primeiro] = cartoes;
    expect(linhas[1]).toBe(
      `${primeiro.codigo},https://go.example.com/c/${primeiro.codigo},GOOGLE,${primeiro.codigo}.svg`,
    );
  });

  it("gera ZIP com a pasta do lote, um SVG por cartão e o CSV", async () => {
    const { lote, cartoes } = await criarLote(db, { quantidade: 5, tipo: null, descricao: null }, em2026);
    const zip = await JSZip.loadAsync(await gerarZipDoLote(lote, cartoes));
    const arquivos = Object.values(zip.files)
      .filter((arquivo) => !arquivo.dir)
      .map((arquivo) => arquivo.name)
      .sort();

    const esperados = [
      ...cartoes.map((c) => `${lote.identificador}/${c.codigo}.svg`),
      `${lote.identificador}/lote.csv`,
    ].sort();
    expect(arquivos).toEqual(esperados);

    const svg = await zip.file(`${lote.identificador}/${cartoes[0].codigo}.svg`)?.async("string");
    expect(svg).toContain("<svg");
    const csv = await zip.file(`${lote.identificador}/lote.csv`)?.async("string");
    expect(csv).toBe(gerarCsvDoLote(cartoes));
  });
});
