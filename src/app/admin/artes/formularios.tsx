"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { enviarArteAction, restaurarArteAction } from "@/app/admin/acoes";
import type { EstadoDeFormulario } from "@/app/admin/tipos-de-acao";
import { classesDoBotao, classesDoCampo } from "@/components/ui";

const estadoInicial: EstadoDeFormulario = {};

function Mensagens({ estado }: { estado: EstadoDeFormulario }) {
  return (
    <>
      {estado.erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      ) : null}
      {estado.sucesso ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {estado.sucesso}
        </p>
      ) : null}
      {estado.aviso ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {estado.aviso}
        </p>
      ) : null}
    </>
  );
}

interface PropsDoEnvio {
  slug: string;
  tamanhoMaximoBytes: number;
  qrXMm: number;
  qrYMm: number;
  qrTamanhoMm: number;
  corDoCodigo: "preto" | "branco" | null;
}

export function FormularioDeEnvioDaArte(props: PropsDoEnvio) {
  const [estado, enviar, pendente] = useActionState(enviarArteAction, estadoInicial);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);
  const id = (campo: string) => `${props.slug}-${campo}`;

  function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (arquivo && arquivo.size > props.tamanhoMaximoBytes) {
      setErroDoArquivo(
        `Este arquivo tem ${(arquivo.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB. O limite é 2 MB.`,
      );
    } else {
      setErroDoArquivo(null);
    }
  }

  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="modelo" value={props.slug} />
      <div>
        <label htmlFor={id("arquivo")} className="mb-1 block text-sm font-medium text-slate-700">
          PDF da arte
        </label>
        <input
          id={id("arquivo")}
          name="arquivo"
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={aoEscolherArquivo}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
        />
        {erroDoArquivo ? <p className="mt-1.5 text-sm text-red-700">{erroDoArquivo}</p> : null}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">
          Área do QR Code (em mm, a partir do canto superior esquerdo do corte)
        </legend>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm text-slate-600">
            Da esquerda
            <input name="qrXMm" type="number" step="0.1" min="0" required defaultValue={props.qrXMm} className={classesDoCampo("mt-1")} />
          </label>
          <label className="text-sm text-slate-600">
            Do topo
            <input name="qrYMm" type="number" step="0.1" min="0" required defaultValue={props.qrYMm} className={classesDoCampo("mt-1")} />
          </label>
          <label className="text-sm text-slate-600">
            Tamanho
            <input name="qrTamanhoMm" type="number" step="0.1" min="1" required defaultValue={props.qrTamanhoMm} className={classesDoCampo("mt-1")} />
          </label>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          O sistema desenha um quadrado branco desse tamanho e o QR Code dentro dele. Deixe essa área livre na arte.
        </p>
      </fieldset>

      <div>
        <label htmlFor={id("cor")} className="mb-1 block text-sm font-medium text-slate-700">
          Código do cartão abaixo do QR Code
        </label>
        <select id={id("cor")} name="corDoCodigo" defaultValue={props.corDoCodigo ?? ""} className={classesDoCampo("sm:max-w-xs")}>
          <option value="preto">Imprimir em preto (fundo claro)</option>
          <option value="branco">Imprimir em branco (fundo escuro)</option>
          <option value="">Não imprimir o código</option>
        </select>
      </div>

      <Mensagens estado={estado} />
      <button type="submit" disabled={pendente || erroDoArquivo !== null} className={classesDoBotao("primario")}>
        {pendente ? "Enviando e conferindo…" : "Enviar arte"}
      </button>
    </form>
  );
}

export function BotaoRestaurarArte({ slug, nome }: { slug: string; nome: string }) {
  const [estado, enviar, pendente] = useActionState(restaurarArteAction, estadoInicial);

  return (
    <form
      action={enviar}
      onSubmit={(evento) => {
        if (!window.confirm(`Voltar o modelo ${nome} para a arte padrão do sistema? A arte enviada será removida.`)) {
          evento.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="modelo" value={slug} />
      <button type="submit" disabled={pendente} className={classesDoBotao("perigo")}>
        {pendente ? "Restaurando…" : "Restaurar arte padrão"}
      </button>
      <Mensagens estado={estado} />
    </form>
  );
}
