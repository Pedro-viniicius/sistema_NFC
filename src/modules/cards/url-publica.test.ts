import { afterEach, describe, expect, it, vi } from "vitest";
import { avisoDaUrlBase, getCardPublicUrl, obterUrlBase } from "./url-publica";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("URL permanente do cartão", () => {
  it("monta a URL canônica a partir do domínio configurado", () => {
    expect(getCardPublicUrl("K8M4T2")).toBe("https://go.example.com/c/K8M4T2");
  });

  it("ignora barra final no domínio configurado", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://go.company.com/");
    expect(getCardPublicUrl("K8M4T2")).toBe("https://go.company.com/c/K8M4T2");
  });

  it("recusa montar URL para código inválido", () => {
    expect(() => getCardPublicUrl("../admin")).toThrow("Código de cartão inválido");
    expect(() => getCardPublicUrl("k8m4t2")).toThrow();
  });

  it("falha se o domínio não estiver configurado, em vez de inventar um", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => obterUrlBase()).toThrow("NEXT_PUBLIC_APP_URL");
  });

  it("exige https fora de localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://go.example.com");
    expect(() => obterUrlBase()).toThrow("https://");
  });

  it("aceita http://localhost apenas em desenvolvimento", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(obterUrlBase()).toBe("http://localhost:3000");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => obterUrlBase()).toThrow();
  });

  it("recusa localhost em produção mesmo com https", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://localhost");
    expect(() => obterUrlBase()).toThrow("localhost");
  });

  it("recusa domínio com caminho", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://go.example.com/app");
    expect(() => obterUrlBase()).toThrow("apenas o domínio");
  });

  it("avisa quando a URL base não é o domínio definitivo", () => {
    expect(avisoDaUrlBase()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://meu-projeto.vercel.app");
    expect(avisoDaUrlBase()).toContain(".vercel.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(avisoDaUrlBase()).toContain("localhost");
  });
});
