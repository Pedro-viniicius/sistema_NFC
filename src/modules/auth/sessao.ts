// Sessão do painel: cookie httpOnly com um JWT assinado. Somente servidor.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { emProducao, obterAuthSecret } from "@/lib/env";
import { buscarAdministradorPorId } from "./servico";
import {
  DURACAO_DA_SESSAO_EM_SEGUNDOS,
  assinarTokenDeSessao,
  verificarTokenDeSessao,
} from "./token";

export const COOKIE_DE_SESSAO = "sessao_admin";

export interface AdminAutenticado {
  id: string;
  email: string;
}

export async function iniciarSessao(adminId: string): Promise<void> {
  const token = await assinarTokenDeSessao(adminId, obterAuthSecret());
  (await cookies()).set(COOKIE_DE_SESSAO, token, {
    httpOnly: true,
    secure: emProducao(),
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_DA_SESSAO_EM_SEGUNDOS,
  });
}

export async function encerrarSessao(): Promise<void> {
  (await cookies()).delete(COOKIE_DE_SESSAO);
}

/**
 * Administrador da requisição atual, ou null. Além de validar a assinatura do cookie,
 * confirma no banco que o administrador ainda existe.
 */
export const obterAdminAtual = cache(async (): Promise<AdminAutenticado | null> => {
  const token = (await cookies()).get(COOKIE_DE_SESSAO)?.value;
  const adminId = await verificarTokenDeSessao(token, obterAuthSecret());
  if (!adminId) return null;
  const admin = await buscarAdministradorPorId(obterBanco(), adminId);
  return admin ? { id: admin.id, email: admin.email } : null;
});

/** Para páginas e Server Actions do painel: sem sessão válida, vai para o login. */
export async function exigirAdmin(): Promise<AdminAutenticado> {
  const admin = await obterAdminAtual();
  if (!admin) redirect("/login");
  return admin;
}
