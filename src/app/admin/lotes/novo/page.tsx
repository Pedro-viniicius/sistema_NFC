import type { Metadata } from "next";
import { obterBanco } from "@/db/cliente";
import { Painel } from "@/components/ui";
import { exigirAdmin } from "@/modules/auth/sessao";
import { QUANTIDADE_MAXIMA_POR_LOTE } from "@/modules/batches/servico";
import { listarTemplatesParaNovosLotes } from "@/modules/templates/servico";
import { FormularioDeLote } from "./formulario-lote";

export const metadata: Metadata = { title: "Novo lote — Cartões NFC" };

export default async function PaginaDeNovoLote() {
  await exigirAdmin();
  // Só templates PRONTOS são oferecidos; o servidor confere de novo ao criar o lote.
  const templates = await listarTemplatesParaNovosLotes(obterBanco());
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Novo lote</h1>
      <Painel descricao="Cada cartão recebe um código único e uma URL permanente. Depois de gerar, exporte os QR Codes para a gráfica.">
        <FormularioDeLote quantidadeMaxima={QUANTIDADE_MAXIMA_POR_LOTE} templates={templates} />
      </Painel>
    </div>
  );
}
