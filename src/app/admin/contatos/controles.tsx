"use client";

// Controles interativos dos contatos: situação (lista), acompanhamento com observação e exclusão.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import {
  ROTULO_SITUACAO,
  SITUACOES_DO_CONTATO,
  TAMANHO_MAXIMO_DA_OBSERVACAO,
  type SituacaoDoContato,
} from "@/modules/contacts/tipos";
import { atualizarAcompanhamentoAction, excluirContatoAction } from "./acoes";

const CORES: Record<SituacaoDoContato, string> = {
  NOVO: "border-sky-300 bg-sky-50 text-sky-900",
  CONVERSANDO: "border-amber-300 bg-amber-50 text-amber-900",
  CLIENTE: "border-emerald-300 bg-emerald-50 text-emerald-900",
  SEM_INTERESSE: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Troca rápida da situação, direto na lista. Salva ao escolher. */
export function SituacaoDoContato({ id, situacao, loja }: { id: string; situacao: SituacaoDoContato; loja: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <div>
      <select
        aria-label={`Situação do contato ${loja}`}
        value={situacao}
        disabled={pendente}
        onChange={(evento) => {
          const nova = evento.target.value;
          setErro(null);
          iniciar(async () => {
            const resultado = await atualizarAcompanhamentoAction(id, { situacao: nova });
            if (!resultado.ok) setErro(resultado.erro);
          });
        }}
        className={`rounded-lg border px-2 py-1.5 text-sm font-medium ${CORES[situacao]}`}
      >
        {SITUACOES_DO_CONTATO.map((opcao) => (
          <option key={opcao} value={opcao}>
            {ROTULO_SITUACAO[opcao]}
          </option>
        ))}
      </select>
      {erro ? <p className="mt-1 text-xs text-red-700">{erro}</p> : null}
    </div>
  );
}

/** Situação e observação, na página do contato. */
export function Acompanhamento({
  id,
  situacao,
  observacao,
}: {
  id: string;
  situacao: SituacaoDoContato;
  observacao: string | null;
}) {
  const [novaSituacao, setNovaSituacao] = useState<string>(situacao);
  const [texto, setTexto] = useState(observacao ?? "");
  const [mensagem, setMensagem] = useState<{ erro: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        setMensagem(null);
        iniciar(async () => {
          const resultado = await atualizarAcompanhamentoAction(id, { situacao: novaSituacao, observacao: texto });
          setMensagem(resultado.ok ? { erro: false, texto: "Acompanhamento salvo." } : { erro: true, texto: resultado.erro });
        });
      }}
    >
      <div>
        <label htmlFor="situacao" className="mb-1 block text-sm font-medium text-slate-700">
          Situação
        </label>
        <select
          id="situacao"
          value={novaSituacao}
          onChange={(evento) => setNovaSituacao(evento.target.value)}
          className={classesDoCampo("sm:max-w-xs")}
        >
          {SITUACOES_DO_CONTATO.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROTULO_SITUACAO[opcao]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="observacao" className="mb-1 block text-sm font-medium text-slate-700">
          Observação
        </label>
        <textarea
          id="observacao"
          rows={4}
          maxLength={TAMANHO_MAXIMO_DA_OBSERVACAO}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Ex.: conversei no dia 10, pediu para voltar a falar no mês que vem."
          className={classesDoCampo()}
        />
      </div>
      {mensagem ? (
        <p
          role={mensagem.erro ? "alert" : "status"}
          className={
            mensagem.erro
              ? "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              : "rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
          }
        >
          {mensagem.texto}
        </p>
      ) : null}
      <button type="submit" disabled={pendente} className={classesDoBotao("primario")}>
        {pendente ? "Salvando…" : "Salvar acompanhamento"}
      </button>
    </form>
  );
}

/** Exclusão dos dados a pedido da pessoa. O cartão continua funcionando. */
export function ExcluirContato({ id, loja }: { id: string; loja: string }) {
  const roteador = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pendente}
        className={classesDoBotao("perigo")}
        onClick={() => {
          const confirmado = window.confirm(
            `Excluir os dados do contato “${loja}”? Nome, loja e WhatsApp são apagados de vez. O cartão continua ativo e funcionando.`,
          );
          if (!confirmado) return;
          setErro(null);
          iniciar(async () => {
            const resultado = await excluirContatoAction(id);
            if (resultado.ok) roteador.push("/admin/contatos?excluido=1");
            else setErro(resultado.erro);
          });
        }}
      >
        {pendente ? "Excluindo…" : "Excluir dados do contato"}
      </button>
      {erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
