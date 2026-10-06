// Regras puras de transição de status do cartão.
import { ErroDeDominio } from "@/lib/erros";
import type { StatusCartao } from "./tipos";

/**
 * Ao receber um destino: o cartão novo passa a ATIVO e o ativo continua ATIVO.
 * Um cartão INATIVO só volta a ATIVO se isso for pedido explicitamente (`ativar`).
 */
export function statusAoConfigurar(atual: StatusCartao, ativar: boolean): StatusCartao {
  if (atual === "INATIVO" && !ativar) return "INATIVO";
  return "ATIVO";
}

/** Reativação: volta a ATIVO se já tem destino; senão, volta a aguardar configuração. */
export function statusAoAtivar(atual: StatusCartao, temDestino: boolean): StatusCartao {
  if (atual === "ATIVO") return "ATIVO";
  if (atual === "NAO_CONFIGURADO") {
    throw new ErroDeDominio(
      "TRANSICAO_INVALIDA",
      "Configure um destino para ativar este cartão.",
    );
  }
  return temDestino ? "ATIVO" : "NAO_CONFIGURADO";
}
