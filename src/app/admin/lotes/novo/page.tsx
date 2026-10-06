import type { Metadata } from "next";
import { Painel } from "@/components/ui";
import { exigirAdmin } from "@/modules/auth/sessao";
import { QUANTIDADE_MAXIMA_POR_LOTE } from "@/modules/batches/servico";
import { FormularioDeLote } from "./formulario-lote";

export const metadata: Metadata = { title: "Novo lote — Cartões NFC" };

export default async function PaginaDeNovoLote() {
  await exigirAdmin();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Novo lote</h1>
      <Painel descricao="Cada cartão recebe um código único e uma URL permanente. Depois de gerar, exporte os QR Codes para a gráfica.">
        <FormularioDeLote quantidadeMaxima={QUANTIDADE_MAXIMA_POR_LOTE} />
      </Painel>
    </div>
  );
}
