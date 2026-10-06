import { describe, expect, it } from "vitest";
import {
  ALFABETO_CODIGO,
  COMPRIMENTO_CODIGO,
  codigoValido,
  extrairCodigo,
  gerarCodigo,
  normalizarCodigo,
} from "./codigo";

describe("geração de código", () => {
  it("gera códigos no formato esperado, sem caracteres ambíguos", () => {
    for (let i = 0; i < 500; i++) {
      const codigo = gerarCodigo();
      expect(codigo).toHaveLength(COMPRIMENTO_CODIGO);
      expect(codigoValido(codigo)).toBe(true);
      expect(codigo).not.toMatch(/[01OIL]/);
    }
  });

  it("o alfabeto não contém 0, O, 1, I nem L", () => {
    expect(ALFABETO_CODIGO).not.toMatch(/[01OIL]/);
    expect(new Set(ALFABETO_CODIGO).size).toBe(ALFABETO_CODIGO.length);
  });

  it("gera códigos praticamente sem repetição", () => {
    const codigos = new Set<string>();
    for (let i = 0; i < 5000; i++) codigos.add(gerarCodigo());
    // 31^6 ≈ 887 milhões de combinações: colisões em 5.000 sorteios são raríssimas.
    expect(codigos.size).toBeGreaterThanOrEqual(4998);
  });

  it("não é sequencial: usa a fonte aleatória para cada caractere", () => {
    const indices = [..."K8M4T2"].map((caractere) => ALFABETO_CODIGO.indexOf(caractere));
    let i = 0;
    expect(gerarCodigo(() => indices[i++])).toBe("K8M4T2");
  });
});

describe("validação de código", () => {
  it("normaliza espaços e minúsculas", () => {
    expect(normalizarCodigo("  k8m4t2 ")).toBe("K8M4T2");
    expect(normalizarCodigo("A8K4P2")).toBe("A8K4P2");
  });

  it.each([
    ["vazio", ""],
    ["curto", "K8M4T"],
    ["longo", "K8M4T2X"],
    ["com zero", "K8M4T0"],
    ["com letra O", "K8M4TO"],
    ["com um", "K8M4T1"],
    ["com letra I", "K8M4TI"],
    ["com letra L", "K8M4TL"],
    ["sequencial numérico", "000001"],
    ["com símbolo", "K8M4-2"],
    ["path traversal", "../../x"],
    ["com acento", "K8M4TÇ"],
  ])("rejeita código %s", (_nome, entrada) => {
    expect(normalizarCodigo(entrada)).toBeNull();
  });

  it("rejeita valores que não são texto", () => {
    expect(normalizarCodigo(null)).toBeNull();
    expect(normalizarCodigo(123456)).toBeNull();
    expect(normalizarCodigo(undefined)).toBeNull();
  });

  it("extrai o código de uma URL permanente colada ou escaneada", () => {
    expect(extrairCodigo("https://go.example.com/c/K8M4T2")).toBe("K8M4T2");
    expect(extrairCodigo("https://go.example.com/c/k8m4t2?x=1")).toBe("K8M4T2");
    expect(extrairCodigo(" K8M4T2 ")).toBe("K8M4T2");
    expect(extrairCodigo("https://go.example.com/c/INVALIDO")).toBeNull();
    expect(extrairCodigo("https://instagram.com/empresa")).toBeNull();
  });
});
