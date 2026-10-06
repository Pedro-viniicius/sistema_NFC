// Primeira barreira do painel: sem cookie de sessão válido, /admin redireciona para o login.
// É uma checagem otimista (só a assinatura do token). A autorização definitiva é feita em
// cada página, Server Action e rota do painel, por exigirAdmin()/obterAdminAtual().
import { NextResponse, type NextRequest } from "next/server";
import { obterAuthSecret } from "@/lib/env";
import { COOKIE_DE_SESSAO, verificarTokenDeSessao } from "@/modules/auth/token";

export async function proxy(requisicao: NextRequest): Promise<NextResponse> {
  const token = requisicao.cookies.get(COOKIE_DE_SESSAO)?.value;
  const adminId = await verificarTokenDeSessao(token, obterAuthSecret());
  if (adminId) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", requisicao.url));
}

export const config = {
  matcher: ["/admin/:path*"],
};
