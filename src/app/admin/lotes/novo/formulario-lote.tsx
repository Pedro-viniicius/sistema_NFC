"use client";

import { useActionState } from "react";
import Link from "next/link";
import { criarLoteAction } from "@/app/admin/acoes";
import type { EstadoDeFormulario } from "@/app/admin/tipos-de-acao";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import { ROTULO_TIPO, TIPOS_DESTINO } from "@/modules/cards/tipos";

const estadoInicial: EstadoDeFormulario = {};

const OPCOES_DE_TIPO = [
  { valor: "", rotulo: "Sem tipo definido" },
  ...TIPOS_DESTINO.map((tipo) => ({ valor: tipo as string, rotulo: ROTULO_TIPO[tipo] })),
];

export function FormularioDeLote({ quantidadeMaxima }: { quantidadeMaxima: number }) {
  const [estado, enviar, pendente] = useActionState(criarLoteAction, estadoInicial);

  return (
    <form action={enviar} className="space-y-5">
      <div>
        <label htmlFor="quantidade" className="mb-1 block text-sm font-medium text-slate-700">
          Quantidade de cartões
        </label>
        <input
          id="quantidade"
          name="quantidade"
          type="number"
          inputMode="numeric"
          min={1}
          max={quantidadeMaxima}
          defaultValue={100}
          required
          className={classesDoCampo("sm:w-40")}
        />
        <p className="mt-1.5 text-sm text-slate-500">Máximo de {quantidadeMaxima.toLocaleString("pt-BR")} por lote.</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Tipo dos cartões</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OPCOES_DE_TIPO.map((opcao, indice) => (
            <label
              key={opcao.valor}
              className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-slate-200 bg-white px-2 py-3 text-center text-sm font-medium text-slate-700 hover:border-slate-400 has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white"
            >
              <input type="radio" name="tipo" value={opcao.valor} defaultChecked={indice === 0} className="sr-only" />
              {opcao.rotulo}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-slate-500">
          O tipo só indica a arte do cartão. O destino de cada cartão é configurado depois, na venda.
        </p>
      </fieldset>

      <div>
        <label htmlFor="descricao" className="mb-1 block text-sm font-medium text-slate-700">
          Descrição (opcional)
        </label>
        <input id="descricao" name="descricao" maxLength={200} placeholder="Ex.: Adesivos redondos 5 cm" className={classesDoCampo()} />
      </div>

      {estado.erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pendente} className={classesDoBotao("primario")}>
          {pendente ? "Gerando…" : "Gerar lote"}
        </button>
        <Link href="/admin/lotes" className={classesDoBotao("secundario")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
