"use client";

// Ações de ciclo de vida de um template (lista e página do template).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResultadoDaAcao } from "@/app/admin/tipos-de-acao";
import {
  ativarTemplateAction,
  definirPadraoAction,
  duplicarTemplateAction,
  excluirTemplateAction,
  inativarTemplateAction,
} from "./acoes";

interface Props {
  id: string;
  nome: string;
  status: "RASCUNHO" | "PRONTO" | "INATIVO";
  padrao: boolean;
  /** Só é verdadeiro quando nenhum lote usa o template. */
  podeExcluir: boolean;
  /** Para onde ir depois de excluir (na página do template, de volta para a lista). */
  aoExcluirIrPara?: string;
}

const BOTAO =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const BOTAO_DE_PERIGO =
  "rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export function AcoesDoTemplate({ id, nome, status, padrao, podeExcluir, aoExcluirIrPara }: Props) {
  const roteador = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function executar<T>(acao: () => Promise<ResultadoDaAcao<T>>, depois?: (dados: T) => void): void {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (!resultado.ok) setErro(resultado.erro);
      else depois?.(resultado.dados);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pendente}
          className={BOTAO}
          onClick={() =>
            executar(
              () => duplicarTemplateAction(id),
              (copia) => roteador.push(`/admin/templates-impressao/${copia.id}`),
            )
          }
        >
          Duplicar como nova versão
        </button>

        {status === "PRONTO" ? (
          <button type="button" disabled={pendente} className={BOTAO} onClick={() => executar(() => definirPadraoAction(id, !padrao))}>
            {padrao ? "Retirar padrão" : "Definir como padrão"}
          </button>
        ) : null}

        {status === "INATIVO" ? (
          <button type="button" disabled={pendente} className={BOTAO} onClick={() => executar(() => ativarTemplateAction(id))}>
            Ativar
          </button>
        ) : null}
        {status === "PRONTO" ? (
          <button
            type="button"
            disabled={pendente}
            className={BOTAO}
            onClick={() => {
              if (window.confirm(`Inativar o template “${nome}”? Ele deixa de aparecer para novos lotes. Os lotes já gerados continuam usando este template.`)) {
                executar(() => inativarTemplateAction(id));
              }
            }}
          >
            Inativar
          </button>
        ) : null}

        {podeExcluir ? (
          <button
            type="button"
            disabled={pendente}
            className={BOTAO_DE_PERIGO}
            onClick={() => {
              if (window.confirm(`Excluir o template “${nome}”? O arquivo da arte também é apagado. Esta ação não pode ser desfeita.`)) {
                executar(
                  () => excluirTemplateAction(id),
                  () => {
                    if (aoExcluirIrPara) roteador.push(aoExcluirIrPara);
                  },
                );
              }
            }}
          >
            Excluir
          </button>
        ) : null}
      </div>
      {erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
