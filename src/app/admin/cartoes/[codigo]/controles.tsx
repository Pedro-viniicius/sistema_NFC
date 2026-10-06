"use client";

// Controles interativos da página do cartão: destino, status e descrição.
import { useState, useTransition, type FormEvent } from "react";
import { alterarStatusAction, atualizarDescricaoAction } from "@/app/admin/acoes";
import { FormularioDestino } from "@/components/formulario-destino";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import type { CartaoResumo } from "@/modules/cards/apresentacao";

export function EditorDeDestino({ cartao }: { cartao: CartaoResumo }) {
  const [editando, setEditando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  if (editando) {
    return (
      <FormularioDestino
        cartao={cartao}
        ativar={false}
        aoCancelar={() => setEditando(false)}
        aoSalvar={() => {
          setEditando(false);
          setSucesso(true);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {sucesso ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          Cartão configurado com sucesso.
        </p>
      ) : null}
      {cartao.destinoUrl ? (
        <a
          href={cartao.destinoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all font-medium text-slate-900 underline underline-offset-2"
        >
          {cartao.destinoUrl}
        </a>
      ) : (
        <p className="text-slate-500">Este cartão ainda não tem destino.</p>
      )}
      <button
        type="button"
        onClick={() => {
          setSucesso(false);
          setEditando(true);
        }}
        className={classesDoBotao("primario")}
      >
        {cartao.destinoUrl ? "Alterar destino" : "Configurar destino"}
      </button>
    </div>
  );
}

export function BotoesDeStatus({ cartao }: { cartao: CartaoResumo }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const inativo = cartao.status === "INATIVO";

  function alterar(operacao: "ativar" | "desativar") {
    if (operacao === "desativar" && !window.confirm("Desativar este cartão? Ele deixará de redirecionar.")) {
      return;
    }
    setErro(null);
    iniciarTransicao(async () => {
      const resultado = await alterarStatusAction({ codigo: cartao.codigo, operacao });
      if (!resultado.ok) setErro(resultado.erro);
    });
  }

  return (
    <div className="space-y-2">
      {inativo ? (
        <button type="button" disabled={pendente} onClick={() => alterar("ativar")} className={classesDoBotao("primario")}>
          {pendente ? "Ativando…" : "Ativar"}
        </button>
      ) : (
        <button type="button" disabled={pendente} onClick={() => alterar("desativar")} className={classesDoBotao("perigo")}>
          {pendente ? "Desativando…" : "Desativar"}
        </button>
      )}
      {erro ? (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

export function EditorDeDescricao({ cartao }: { cartao: CartaoResumo }) {
  const [descricao, setDescricao] = useState(cartao.descricao ?? "");
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    setMensagem(null);
    iniciarTransicao(async () => {
      const resultado = await atualizarDescricaoAction({ codigo: cartao.codigo, descricao });
      setMensagem(
        resultado.ok ? { tipo: "ok", texto: "Descrição salva." } : { tipo: "erro", texto: resultado.erro },
      );
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-2">
      <label htmlFor="descricao" className="block text-sm font-medium text-slate-700">
        Descrição (uso interno)
      </label>
      <div className="flex gap-2">
        <input
          id="descricao"
          value={descricao}
          onChange={(evento) => setDescricao(evento.target.value)}
          maxLength={200}
          placeholder="Ex.: Padaria do João — balcão"
          className={classesDoCampo()}
        />
        <button type="submit" disabled={pendente} className={classesDoBotao("secundario")}>
          {pendente ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {mensagem ? (
        <p role="status" className={mensagem.tipo === "ok" ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
          {mensagem.texto}
        </p>
      ) : null}
    </form>
  );
}
