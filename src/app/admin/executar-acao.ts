// Base comum das Server Actions do painel: confere a sessão e transforma erros em mensagens
// seguras para o administrador. (Não é um arquivo "use server": nada aqui vira endpoint.)
import "server-only";
import { z } from "zod";
import { obterBanco } from "@/db/cliente";
import type { Banco } from "@/db/tipos";
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { exigirAdmin, type AdminAutenticado } from "@/modules/auth/sessao";
import type { ResultadoDaAcao } from "./tipos-de-acao";

const ERRO_INESPERADO = "Ocorreu um erro inesperado. Tente novamente.";

export function mensagemParaOAdmin(erro: unknown): string {
  if (erro instanceof ErroDeDominio) return erro.message;
  if (erro instanceof z.ZodError) return erro.issues[0]?.message ?? "Dados inválidos.";
  if (erro instanceof ErroDeConfiguracao) {
    registrarLog("erro", "admin.configuracao_invalida", { mensagem: erro.message });
    return erro.message;
  }
  registrarLog("erro", "admin.acao_falhou", { mensagem: mensagemDoErro(erro) });
  return ERRO_INESPERADO;
}

export async function executar<T>(
  operacao: (db: Banco, admin: AdminAutenticado) => Promise<T>,
): Promise<ResultadoDaAcao<T>> {
  const admin = await exigirAdmin();
  try {
    return { ok: true, dados: await operacao(obterBanco(), admin) };
  } catch (erro) {
    return { ok: false, erro: mensagemParaOAdmin(erro) };
  }
}
