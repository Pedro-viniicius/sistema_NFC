"use server";

// Server Actions dos contatos e da opção "Ativação pelo cliente" dos lotes.
import { revalidatePath } from "next/cache";
import { registrarLog } from "@/lib/log";
import { pendenciasDaConfiguracao } from "@/modules/activation/configuracao";
import { definirAtivacaoPeloCliente } from "@/modules/activation/servico";
import { atualizarAcompanhamento, excluirContato } from "@/modules/contacts/servico";
import { executar } from "../executar-acao";
import type { ResultadoDaAcao } from "../tipos-de-acao";

function atualizarTelas(): void {
  revalidatePath("/admin", "layout");
}

export async function atualizarAcompanhamentoAction(
  id: string,
  dados: { situacao: string; observacao?: string | null },
): Promise<ResultadoDaAcao<{ situacao: string }>> {
  return executar(async (db, admin) => {
    const contato = await atualizarAcompanhamento(db, String(id), dados);
    registrarLog("info", "contatos.acompanhamento_atualizado", {
      contatoId: contato.id,
      situacao: contato.situacao,
      adminId: admin.id,
    });
    atualizarTelas();
    return { situacao: contato.situacao };
  });
}

/** Exclusão a pedido do titular dos dados. O cartão continua ativo. */
export async function excluirContatoAction(id: string): Promise<ResultadoDaAcao<{ cartaoCodigo: string }>> {
  return executar(async (db, admin) => {
    const excluido = await excluirContato(db, String(id));
    // O log registra que houve a exclusão, sem nenhum dado da pessoa.
    registrarLog("aviso", "contatos.excluido_a_pedido", {
      contatoId: String(id),
      cartao: excluido.cartaoCodigo,
      adminId: admin.id,
    });
    atualizarTelas();
    return excluido;
  });
}

export async function definirAtivacaoPeloClienteAction(
  identificador: string,
  ligar: boolean,
): Promise<ResultadoDaAcao<{ ativacaoPeloCliente: boolean }>> {
  return executar(async (db, admin) => {
    const lote = await definirAtivacaoPeloCliente(db, String(identificador), ligar === true, pendenciasDaConfiguracao());
    registrarLog("info", "lotes.ativacao_pelo_cliente", {
      lote: lote.identificador,
      ligada: lote.ativacaoPeloCliente,
      adminId: admin.id,
    });
    atualizarTelas();
    return { ativacaoPeloCliente: lote.ativacaoPeloCliente };
  });
}
