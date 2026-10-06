"use client";

import { useActionState, useState } from "react";
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

interface TemplateDisponivel {
  id: string;
  nome: string;
  tipo: string | null;
  padrao: boolean;
}

interface Props {
  quantidadeMaxima: number;
  /** Templates de impressão PRONTOS, de todos os produtos. */
  templates: TemplateDisponivel[];
}

export function FormularioDeLote({ quantidadeMaxima, templates }: Props) {
  const [estado, enviar, pendente] = useActionState(criarLoteAction, estadoInicial);
  const [tipo, setTipo] = useState("");
  const doProduto = templates.filter((template) => tipo !== "" && template.tipo === tipo);
  const padrao = doProduto.find((template) => template.padrao);

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
          {OPCOES_DE_TIPO.map((opcao) => (
            <label
              key={opcao.valor}
              className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-slate-200 bg-white px-2 py-3 text-center text-sm font-medium text-slate-700 hover:border-slate-400 has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white"
            >
              <input
                type="radio"
                name="tipo"
                value={opcao.valor}
                checked={tipo === opcao.valor}
                onChange={() => setTipo(opcao.valor)}
                className="sr-only"
              />
              {opcao.rotulo}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-slate-500">
          O tipo só indica a arte do cartão. O destino de cada cartão é configurado depois, na venda.
        </p>
      </fieldset>

      {doProduto.length > 0 ? (
        <div>
          <label htmlFor="templateId" className="mb-1 block text-sm font-medium text-slate-700">
            Template de impressão
          </label>
          {/* A chave reinicia a escolha quando o produto muda: o padrão do novo produto vem sugerido. */}
          <select key={tipo} id="templateId" name="templateId" defaultValue={padrao?.id ?? ""} className={classesDoCampo()}>
            {doProduto.map((template) => (
              <option key={template.id} value={template.id}>
                {template.nome}
                {template.padrao ? " (padrão)" : ""}
              </option>
            ))}
            <option value="">Sem template (modelo do sistema)</option>
          </select>
          <p className="mt-1.5 text-sm text-slate-500">
            O lote fica ligado a este template para sempre: os arquivos dele serão sempre gerados com esta arte.
          </p>
        </div>
      ) : tipo !== "" ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Não há template de impressão pronto para este produto: o lote usará o modelo do sistema. Para usar a sua
          arte,{" "}
          <Link href="/admin/templates-impressao" className="font-medium underline underline-offset-2">
            envie um template
          </Link>{" "}
          antes de gerar o lote.
        </p>
      ) : null}

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
