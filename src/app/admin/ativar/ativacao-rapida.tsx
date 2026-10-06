"use client";

// Ativação rápida, pensada para o momento da venda:
// 1) código  2) tipo  3) colar o link  4) salvar  →  confirmação  →  próximo cartão.
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { buscarCartaoAction } from "@/app/admin/acoes";
import { BotaoCopiar } from "@/components/botao-copiar";
import { FormularioDestino } from "@/components/formulario-destino";
import { SeloDeStatus, classesDoBotao, classesDoCampo } from "@/components/ui";
import type { CartaoResumo } from "@/modules/cards/apresentacao";

type Etapa =
  | { nome: "codigo" }
  | { nome: "destino"; cartao: CartaoResumo }
  | { nome: "concluido"; cartao: CartaoResumo };

function AvisoDoCartao({ cartao }: { cartao: CartaoResumo }) {
  if (cartao.status === "ATIVO") {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Este cartão já está ativo. Salvar vai <strong>alterar o destino atual</strong>.
      </p>
    );
  }
  if (cartao.status === "INATIVO") {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Este cartão está inativo. Salvar vai <strong>reativá-lo</strong> com o novo destino.
      </p>
    );
  }
  return null;
}

export function AtivacaoRapida({ cartaoInicial }: { cartaoInicial: CartaoResumo | null }) {
  const [etapa, setEtapa] = useState<Etapa>(
    cartaoInicial ? { nome: "destino", cartao: cartaoInicial } : { nome: "codigo" },
  );
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, iniciarBusca] = useTransition();

  function buscar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    iniciarBusca(async () => {
      const resultado = await buscarCartaoAction(codigo);
      if (resultado.ok) setEtapa({ nome: "destino", cartao: resultado.dados });
      else setErro(resultado.erro);
    });
  }

  function proximoCartao() {
    setCodigo("");
    setErro(null);
    setEtapa({ nome: "codigo" });
  }

  if (etapa.nome === "codigo") {
    return (
      <form onSubmit={buscar} className="space-y-4">
        <div>
          <label htmlFor="codigo" className="mb-1 block text-sm font-medium text-slate-700">
            Código do cartão
          </label>
          <input
            id="codigo"
            value={codigo}
            onChange={(evento) => {
              setCodigo(evento.target.value);
              setErro(null);
            }}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="K8M4T2"
            className={classesDoCampo("font-mono text-2xl uppercase tracking-widest placeholder:normal-case placeholder:tracking-widest")}
          />
          <p className="mt-1.5 text-sm text-slate-500">
            Digite os 6 caracteres ou cole a URL lida do QR Code do cartão.
          </p>
        </div>
        {erro ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {erro}
          </p>
        ) : null}
        <button type="submit" disabled={buscando || codigo.trim() === ""} className={classesDoBotao("primario", "w-full py-3 text-base")}>
          {buscando ? "Buscando…" : "Continuar"}
        </button>
      </form>
    );
  }

  if (etapa.nome === "destino") {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-semibold tracking-widest text-slate-900">{etapa.cartao.codigo}</span>
          <SeloDeStatus status={etapa.cartao.status} />
          <button type="button" onClick={proximoCartao} className="ml-auto text-sm text-slate-500 underline hover:text-slate-900">
            Trocar cartão
          </button>
        </div>
        <AvisoDoCartao cartao={etapa.cartao} />
        <FormularioDestino
          cartao={etapa.cartao}
          ativar
          aoSalvar={(cartao) => setEtapa({ nome: "concluido", cartao })}
        />
      </div>
    );
  }

  const { cartao } = etapa;
  return (
    <div className="space-y-5">
      <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-base font-medium text-emerald-800">
        Cartão configurado com sucesso.
      </p>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-slate-500">Código do cartão</dt>
          <dd className="font-mono text-xl font-semibold tracking-widest text-slate-900">{cartao.codigo}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Destino configurado</dt>
          <dd className="break-all font-medium text-slate-900">{cartao.destinoUrl}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Status</dt>
          <dd className="mt-0.5">
            <SeloDeStatus status={cartao.status} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">URL permanente (QR Code e NFC)</dt>
          <dd className="break-all font-mono text-slate-900">{cartao.urlPermanente}</dd>
        </div>
      </dl>
      <button type="button" autoFocus onClick={proximoCartao} className={classesDoBotao("primario", "w-full py-3 text-base")}>
        Configurar próximo cartão
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <BotaoCopiar texto={cartao.urlPermanente} rotulo="Copiar URL permanente" />
        <Link href={`/admin/cartoes/${cartao.codigo}`} className={classesDoBotao("secundario")}>
          Abrir cartão
        </Link>
      </div>
    </div>
  );
}
