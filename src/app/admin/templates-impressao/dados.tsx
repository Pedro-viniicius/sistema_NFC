"use client";

import { useState, useTransition } from "react";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import { ROTULO_TIPO, TIPOS_DESTINO, ehTipoDestino } from "@/modules/cards/tipos";
import { atualizarDadosDoTemplateAction } from "./acoes";

interface Props {
  id: string;
  nome: string;
  tipo: string | null;
  tamanhoMaximoDoNome: number;
  /** Template já usado por um lote: o produto não muda mais (o nome pode). */
  bloqueado: boolean;
}

export function DadosDoTemplate({ id, nome, tipo, tamanhoMaximoDoNome, bloqueado }: Props) {
  const [novoNome, setNovoNome] = useState(nome);
  const [novoTipo, setNovoTipo] = useState(tipo ?? "");
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const alterado = novoNome.trim() !== nome || novoTipo !== (tipo ?? "");

  function salvar(evento: React.FormEvent): void {
    evento.preventDefault();
    setMensagem(null);
    iniciar(async () => {
      const resultado = await atualizarDadosDoTemplateAction(id, {
        nome: novoNome,
        tipo: ehTipoDestino(novoTipo) ? novoTipo : null,
      });
      setMensagem(
        resultado.ok ? { tipo: "sucesso", texto: "Dados salvos." } : { tipo: "erro", texto: resultado.erro },
      );
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="template-produto" className="mb-1 block text-sm font-medium text-slate-700">
            Produto
          </label>
          <select
            id="template-produto"
            value={novoTipo}
            disabled={bloqueado}
            onChange={(evento) => setNovoTipo(evento.target.value)}
            className={classesDoCampo()}
          >
            <option value="">Escolha o produto…</option>
            {TIPOS_DESTINO.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_TIPO[opcao]}
              </option>
            ))}
          </select>
          {bloqueado ? (
            <p className="mt-1.5 text-xs text-slate-500">O produto não muda depois que o template é usado em um lote.</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="template-nome" className="mb-1 block text-sm font-medium text-slate-700">
            Nome
          </label>
          <input
            id="template-nome"
            value={novoNome}
            maxLength={tamanhoMaximoDoNome}
            required
            placeholder="Ex.: Google — Modelo 01"
            onChange={(evento) => setNovoNome(evento.target.value)}
            className={classesDoCampo()}
          />
        </div>
      </div>

      {mensagem ? (
        <p
          role={mensagem.tipo === "erro" ? "alert" : "status"}
          className={
            mensagem.tipo === "erro"
              ? "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              : "rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
          }
        >
          {mensagem.texto}
        </p>
      ) : null}

      <button type="submit" disabled={pendente || !alterado} className={classesDoBotao("secundario")}>
        {pendente ? "Salvando…" : "Salvar produto e nome"}
      </button>
    </form>
  );
}
