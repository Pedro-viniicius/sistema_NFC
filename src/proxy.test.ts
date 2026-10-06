import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { obterAuthSecret } from "@/lib/env";
import { COOKIE_DE_SESSAO, assinarTokenDeSessao } from "@/modules/auth/token";
import { config, proxy } from "./proxy";

function requisicao(caminho: string, token?: string): NextRequest {
  const headers = token ? { cookie: `${COOKIE_DE_SESSAO}=${token}` } : undefined;
  return new NextRequest(`https://go.example.com${caminho}`, { headers });
}

describe("proteção do painel (proxy)", () => {
  it("cobre todas as rotas de /admin", () => {
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });

  it("sem sessão, redireciona para o login", async () => {
    const resposta = await proxy(requisicao("/admin/cartoes"));
    expect(resposta.status).toBe(307);
    expect(resposta.headers.get("location")).toBe("https://go.example.com/login");
  });

  it("com token adulterado ou assinado com outro segredo, redireciona para o login", async () => {
    const valido = await assinarTokenDeSessao("admin-1", obterAuthSecret());
    const deOutroSegredo = await assinarTokenDeSessao(
      "admin-1",
      new TextEncoder().encode("um-segredo-diferente-com-mais-de-32-caracteres"),
    );
    for (const token of [`${valido}x`, deOutroSegredo, "qualquer-coisa"]) {
      const resposta = await proxy(requisicao("/admin", token));
      expect(resposta.headers.get("location")).toBe("https://go.example.com/login");
    }
  });

  it("com sessão válida, deixa a requisição seguir", async () => {
    const token = await assinarTokenDeSessao("admin-1", obterAuthSecret());
    const resposta = await proxy(requisicao("/admin/ativar", token));
    expect(resposta.headers.get("location")).toBeNull();
    expect(resposta.headers.get("x-middleware-next")).toBe("1");
  });
});
