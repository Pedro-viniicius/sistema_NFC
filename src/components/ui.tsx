// Peças visuais básicas do painel (sem estado, usáveis no servidor e no cliente).
import type { ReactNode } from "react";
import { ROTULO_STATUS, ROTULO_TIPO, type StatusCartao, type TipoDestino } from "@/modules/cards/tipos";

type VarianteDeBotao = "primario" | "secundario" | "perigo";

const BASE_DO_BOTAO =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTES_DE_BOTAO: Record<VarianteDeBotao, string> = {
  primario: "bg-slate-900 text-white hover:bg-slate-700",
  secundario: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  perigo: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
};

export function classesDoBotao(variante: VarianteDeBotao = "primario", extra = ""): string {
  return `${BASE_DO_BOTAO} ${VARIANTES_DE_BOTAO[variante]} ${extra}`.trim();
}

export function classesDoCampo(extra = ""): string {
  return (
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 " +
    "placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 " +
    extra
  ).trim();
}

const CORES_DE_STATUS: Record<StatusCartao, string> = {
  NAO_CONFIGURADO: "bg-amber-50 text-amber-800 ring-amber-200",
  ATIVO: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  INATIVO: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function SeloDeStatus({ status }: { status: StatusCartao }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CORES_DE_STATUS[status]}`}
    >
      {ROTULO_STATUS[status]}
    </span>
  );
}

export function rotuloDoTipo(tipo: TipoDestino | null): string {
  return tipo ? ROTULO_TIPO[tipo] : "—";
}

export function Painel({
  titulo,
  descricao,
  children,
}: {
  titulo?: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      {titulo ? <h2 className="text-base font-semibold text-slate-900">{titulo}</h2> : null}
      {descricao ? <p className="mt-1 text-sm text-slate-500">{descricao}</p> : null}
      <div className={titulo ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function TituloDaPagina({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
