// Proteção para Route Handlers do painel (downloads): responde 401 em vez de redirecionar.
import "server-only";
import { obterAdminAtual, type AdminAutenticado } from "./sessao";

export async function exigirAdminNaRota(): Promise<AdminAutenticado | Response> {
  const admin = await obterAdminAtual();
  return admin ?? new Response("Não autorizado.", { status: 401, headers: { "Cache-Control": "no-store" } });
}
