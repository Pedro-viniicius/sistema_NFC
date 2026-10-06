import { ROTULO_STATUS_TEMPLATE, type StatusTemplate } from "@/modules/templates/tipos";

const CORES: Record<StatusTemplate, string> = {
  RASCUNHO: "bg-amber-50 text-amber-800 ring-amber-200",
  PRONTO: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  INATIVO: "bg-slate-100 text-slate-600 ring-slate-200",
};

const BASE = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function SeloDoTemplate({ status }: { status: StatusTemplate }) {
  return <span className={`${BASE} ${CORES[status]}`}>{ROTULO_STATUS_TEMPLATE[status]}</span>;
}

export function SeloDePadrao() {
  return <span className={`${BASE} bg-sky-50 text-sky-800 ring-sky-200`}>Padrão</span>;
}
