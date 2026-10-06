"use client";

import { useActionState, useState } from "react";
import { excluirLoteAction } from "@/app/admin/acoes";
import type { EstadoDeFormulario } from "@/app/admin/tipos-de-acao";
import { classesDoBotao, classesDoCampo } from "@/components/ui";

const estadoInicial: EstadoDeFormulario = {};

interface Props {
  identificador: string;
  total: number;
  configurados: number;
  comAcessos: number;
}

export function ApagarLote({ identificador, total, configurados, comAcessos }: Props) {
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [estado, enviar, pendente] = useActionState(excluirLoteAction, estadoInicial);

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={classesDoBotao("perigo")}>
        Apagar lote
      </button>
    );
  }

  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="identificador" value={identificador} />
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="font-semibold">Esta ação não pode ser desfeita.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            O lote e {total === 1 ? "o seu cartão" : `os seus ${total.toLocaleString("pt-BR")} cartões`} serão apagados.
          </li>
          <li>
            Os QR Codes e os chips NFC desses cartões <strong>param de funcionar para sempre</strong>, mesmo que já
            estejam impressos.
          </li>
          {configurados > 0 ? (
            <li>
              <strong>
                {configurados} {configurados === 1 ? "cartão já está configurado" : "cartões já estão configurados"}
              </strong>{" "}
              com destino. Se algum já foi entregue a um cliente, ele deixará de redirecionar.
            </li>
          ) : null}
          {comAcessos > 0 ? (
            <li>
              {comAcessos} {comAcessos === 1 ? "cartão já recebeu acessos" : "cartões já receberam acessos"}.
            </li>
          ) : null}
        </ul>
      </div>
      <div>
        <label htmlFor="confirmacao" className="mb-1 block text-sm font-medium text-slate-700">
          Para confirmar, digite <span className="font-mono font-semibold">{identificador}</span>
        </label>
        <input
          id="confirmacao"
          name="confirmacao"
          value={confirmacao}
          onChange={(evento) => setConfirmacao(evento.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={classesDoCampo("font-mono sm:max-w-xs")}
        />
      </div>
      {estado.erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pendente || confirmacao.trim() !== identificador}
          className={classesDoBotao("perigo")}
        >
          {pendente ? "Apagando…" : "Apagar lote definitivamente"}
        </button>
        <button type="button" onClick={() => setAberto(false)} disabled={pendente} className={classesDoBotao("secundario")}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
