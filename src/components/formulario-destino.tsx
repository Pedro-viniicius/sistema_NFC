"use client";

// Formulário único de configuração de destino, usado na ativação rápida e na página do cartão.
import { useRef, useState, useTransition, type ClipboardEvent, type FormEvent } from "react";
import { configurarDestinoAction } from "@/app/admin/acoes";
import type { CartaoResumo } from "@/modules/cards/apresentacao";
import { sugerirTipo, validarDestinoUrl } from "@/modules/cards/destino";
import { ROTULO_TIPO, TIPOS_DESTINO, type TipoDestino } from "@/modules/cards/tipos";
import { classesDoBotao, classesDoCampo } from "./ui";

const EXEMPLO_POR_TIPO: Record<TipoDestino, string> = {
  INSTAGRAM: "@minhaempresa ou link do perfil",
  GOOGLE: "https://g.page/r/.../review",
  GENERICO: "https://empresa.com.br",
};

interface Props {
  cartao: CartaoResumo;
  /** Se verdadeiro, um cartão inativo volta a ficar ativo ao salvar. */
  ativar: boolean;
  aoSalvar: (cartao: CartaoResumo) => void;
  aoCancelar?: () => void;
}

export function FormularioDestino({ cartao, ativar, aoSalvar, aoCancelar }: Props) {
  const [tipo, setTipo] = useState<TipoDestino | null>(cartao.tipo);
  const [url, setUrl] = useState(cartao.destinoUrl ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const campoUrl = useRef<HTMLInputElement>(null);

  // Pré-visualização apenas: a validação que vale é refeita no servidor ao salvar.
  const previa = tipo && url.trim() ? validarDestinoUrl(url, { tipo }) : null;
  const podeSalvar = previa?.ok === true && !pendente;

  function escolherTipo(novoTipo: TipoDestino) {
    setTipo(novoTipo);
    setErro(null);
    campoUrl.current?.focus();
  }

  function aoColar(evento: ClipboardEvent<HTMLInputElement>) {
    if (tipo) return;
    const sugerido = sugerirTipo(evento.clipboardData.getData("text"));
    if (sugerido) setTipo(sugerido);
  }

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!tipo || !podeSalvar) return;
    setErro(null);
    iniciarTransicao(async () => {
      const resultado = await configurarDestinoAction({
        codigo: cartao.codigo,
        tipo,
        destinoUrl: url,
        ativar,
      });
      if (resultado.ok) aoSalvar(resultado.dados);
      else setErro(resultado.erro);
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Tipo de destino</legend>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS_DESTINO.map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={tipo === opcao}
              onClick={() => escolherTipo(opcao)}
              className={
                tipo === opcao
                  ? "rounded-lg border-2 border-slate-900 bg-slate-900 px-2 py-3 text-sm font-medium text-white"
                  : "rounded-lg border-2 border-slate-200 bg-white px-2 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
              }
            >
              {ROTULO_TIPO[opcao]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="destino-url" className="mb-1 block text-sm font-medium text-slate-700">
          URL de destino
        </label>
        <input
          id="destino-url"
          ref={campoUrl}
          value={url}
          onChange={(evento) => {
            setUrl(evento.target.value);
            setErro(null);
          }}
          onPaste={aoColar}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={tipo ? EXEMPLO_POR_TIPO[tipo] : "Cole o link aqui"}
          className={classesDoCampo()}
        />
        {previa && !previa.ok ? <p className="mt-1.5 text-sm text-red-700">{previa.erro}</p> : null}
        {!tipo && url.trim() ? (
          <p className="mt-1.5 text-sm text-slate-500">Escolha o tipo de destino acima.</p>
        ) : null}
      </div>

      <dl className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <div>
          <dt className="text-slate-500">Destino que será salvo</dt>
          <dd className="break-all font-medium text-slate-900">{previa?.ok ? previa.url : "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">URL permanente do cartão (não muda)</dt>
          <dd className="break-all font-mono text-slate-900">{cartao.urlPermanente}</dd>
        </div>
      </dl>

      {erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!podeSalvar} className={classesDoBotao("primario", "flex-1 sm:flex-none")}>
          {pendente ? "Salvando…" : "Salvar"}
        </button>
        {aoCancelar ? (
          <button type="button" onClick={aoCancelar} disabled={pendente} className={classesDoBotao("secundario")}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
