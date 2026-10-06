import { describe, expect, it } from "vitest";
import { statusAoAtivar, statusAoConfigurar } from "./regras";

describe("regras de status", () => {
  it("configurar ativa o cartão novo e mantém o ativo", () => {
    expect(statusAoConfigurar("NAO_CONFIGURADO", false)).toBe("ATIVO");
    expect(statusAoConfigurar("ATIVO", false)).toBe("ATIVO");
  });

  it("configurar não reativa um cartão inativo sem pedido explícito", () => {
    expect(statusAoConfigurar("INATIVO", false)).toBe("INATIVO");
    expect(statusAoConfigurar("INATIVO", true)).toBe("ATIVO");
  });

  it("reativar depende de haver destino", () => {
    expect(statusAoAtivar("INATIVO", true)).toBe("ATIVO");
    expect(statusAoAtivar("INATIVO", false)).toBe("NAO_CONFIGURADO");
    expect(statusAoAtivar("ATIVO", true)).toBe("ATIVO");
    expect(() => statusAoAtivar("NAO_CONFIGURADO", false)).toThrow("Configure um destino");
  });
});
