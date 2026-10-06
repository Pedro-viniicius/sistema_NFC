import { describe, expect, it } from "vitest";
import { validarDestinoUrl } from "./destino";

const producao = { desenvolvimento: false } as const;

function aceito(entrada: string, opcoes: Parameters<typeof validarDestinoUrl>[1] = producao): string {
  const resultado = validarDestinoUrl(entrada, opcoes);
  if (!resultado.ok) throw new Error(`Esperava aceitar "${entrada}": ${resultado.erro}`);
  return resultado.url;
}

function rejeitado(entrada: unknown, opcoes: Parameters<typeof validarDestinoUrl>[1] = producao): string {
  const resultado = validarDestinoUrl(entrada, opcoes);
  if (resultado.ok) throw new Error(`Esperava rejeitar "${String(entrada)}", mas virou ${resultado.url}`);
  return resultado.erro;
}

describe("destinos aceitos", () => {
  it("aceita perfil do Instagram", () => {
    expect(aceito("https://instagram.com/minhaempresa", { ...producao, tipo: "INSTAGRAM" })).toBe(
      "https://instagram.com/minhaempresa",
    );
    expect(aceito("https://www.instagram.com/minhaempresa/", { ...producao, tipo: "INSTAGRAM" })).toBe(
      "https://www.instagram.com/minhaempresa/",
    );
  });

  it("converte @usuario em link do Instagram", () => {
    expect(aceito("@minha.empresa", { ...producao, tipo: "INSTAGRAM" })).toBe(
      "https://www.instagram.com/minha.empresa/",
    );
  });

  it.each([
    "https://g.page/r/example/review",
    "https://search.google.com/local/writereview?placeid=ChIJabc123",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://www.google.com/maps/place/Empresa",
    "https://www.google.com.br/maps/place/Empresa",
  ])("aceita link do Google: %s", (url) => {
    expect(aceito(url, { ...producao, tipo: "GOOGLE" })).toBe(url);
  });

  it("aceita URL genérica https", () => {
    expect(aceito("https://empresa.com.br", { ...producao, tipo: "GENERICO" })).toBe(
      "https://empresa.com.br/",
    );
    expect(aceito("https://wa.me/5535999999999?text=Ol%C3%A1")).toBe(
      "https://wa.me/5535999999999?text=Ol%C3%A1",
    );
  });

  it("normaliza: remove espaços nas pontas e assume https quando falta o esquema", () => {
    expect(aceito("  instagram.com/minhaempresa  ")).toBe("https://instagram.com/minhaempresa");
    expect(aceito("HTTPS://Empresa.COM.BR/Contato")).toBe("https://empresa.com.br/Contato");
  });

  it("aceita http e localhost somente em desenvolvimento", () => {
    expect(aceito("http://localhost:3000/teste", { desenvolvimento: true })).toBe(
      "http://localhost:3000/teste",
    );
    expect(aceito("http://empresa.com.br", { desenvolvimento: true })).toBe("http://empresa.com.br/");
    rejeitado("http://empresa.com.br");
    rejeitado("https://localhost/teste");
  });
});

describe("destinos rejeitados", () => {
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: com maiúsculas", "JaVaScRiPt:alert(document.cookie)"],
    ["javascript: com espaço à frente", "   javascript:alert(1)"],
    ["javascript: com quebra de linha", "java\nscript:alert(1)"],
    ["javascript: com tab", "java\tscript:alert(1)"],
    ["javascript:// disfarçado", "javascript://instagram.com/%0aalert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["data: base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["file:", "file:///etc/passwd"],
    ["ftp:", "ftp://empresa.com.br/arquivo"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["blob:", "blob:https://empresa.com.br/abc"],
    ["intent:", "intent://scan/#Intent;scheme=zxing;end"],
    ["http em produção", "http://empresa.com.br"],
    ["relativa ao protocolo", "//malicioso.com"],
    ["caminho relativo", "/admin"],
    ["barra invertida", "https:\\\\malicioso.com"],
    ["credenciais embutidas", "https://instagram.com@malicioso.com/"],
    ["usuário e senha", "https://usuario:senha@empresa.com.br"],
    ["IP", "https://192.168.0.1/admin"],
    ["IPv6", "https://[::1]/"],
    ["sem domínio de topo", "https://intranet/"],
    ["o próprio sistema (laço)", "https://go.example.com/c/K8M4T2"],
    ["vazia", "   "],
    ["espaço no meio", "https://empresa.com.br/minha pagina"],
  ])("rejeita %s", (_nome, entrada) => {
    expect(rejeitado(entrada)).toBeTruthy();
  });

  it("rejeita valores que não são texto", () => {
    rejeitado(null);
    rejeitado(undefined);
    rejeitado(42);
    rejeitado({ href: "https://empresa.com.br" });
  });

  it("rejeita URL longa demais", () => {
    rejeitado(`https://empresa.com.br/${"a".repeat(2100)}`);
  });

  it("exige domínio do Instagram quando o tipo é Instagram", () => {
    const opcoes = { ...producao, tipo: "INSTAGRAM" } as const;
    expect(rejeitado("https://empresa.com.br", opcoes)).toContain("Instagram");
    rejeitado("https://instagram.com.malicioso.com/empresa", opcoes);
    rejeitado("https://falsoinstagram.com/empresa", opcoes);
  });

  it("exige domínio do Google quando o tipo é Google", () => {
    const opcoes = { ...producao, tipo: "GOOGLE" } as const;
    expect(rejeitado("https://instagram.com/empresa", opcoes)).toContain("Google");
    rejeitado("https://google.com.malicioso.com/review", opcoes);
    rejeitado("https://g.page.malicioso.com/r/x/review", opcoes);
  });
});
