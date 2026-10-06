"use client";

import { useState, useTransition } from "react";
import { definirAtivacaoPeloClienteAction } from "@/app/admin/contatos/acoes";
import { classesDoBotao } from "@/components/ui";

interface Props {
  identificador: string;
  ligada: boolean;
  /** Por que a opção não pode ser ligada neste lote (tipo do lote ou configuração faltando). */
  impedimento: string | null;
}

export function AtivacaoPeloCliente({ identificador, ligada, impedimento }: Props) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function alternar(): void {
    const mensagem = ligada
      ? "Desligar a ativação pelo cliente? Os cartões ainda não ativados deste lote voltam a mostrar “aguardando configuração”."
      : "Ligar a ativação pelo cliente? Qualquer pessoa com um cartão deste lote em mãos poderá ativá-lo. Ligue só quando os cartões estiverem saindo para entrega.";
    if (!window.confirm(mensagem)) return;
    setErro(null);
    iniciar(async () => {
      const resultado = await definirAtivacaoPeloClienteAction(identificador, !ligada);
      if (!resultado.ok) setErro(resultado.erro);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            ligada
              ? "rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"
              : "rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
          }
        >
          {ligada ? "Ligada" : "Desligada"}
        </span>
        <button
          type="button"
          onClick={alternar}
          disabled={pendente || (!ligada && impedimento !== null)}
          className={classesDoBotao(ligada ? "secundario" : "primario")}
        >
          {pendente ? "Salvando…" : ligada ? "Desligar" : "Ligar ativação pelo cliente"}
        </button>
      </div>
      {!ligada && impedimento ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{impedimento}</p> : null}
      {erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
