import type { Metadata } from "next";
import Link from "next/link";
import { Painel } from "@/components/ui";
import { exigirAdmin } from "@/modules/auth/sessao";
import { MAX_TEMPLATE_BYTES } from "@/modules/templates/validacao-do-pdf";
import { modoDeEnvio } from "../armazenamento";
import { EnvioDeTemplate } from "../envio";

export const metadata: Metadata = { title: "Novo template — Cartões NFC" };

const ETAPAS = [
  ["Enviar o PDF", "O arquivo é validado e salvo como rascunho na hora."],
  ["Produto e nome", "Ex.: Google — Modelo 01."],
  ["Área do QR", "Você arrasta um retângulo sobre o espaço em branco da arte."],
  ["Testar QR", "O servidor gera o PDF final com um QR de teste."],
  ["Salvar e ativar", "O template passa a poder ser usado em novos lotes."],
] as const;

export default async function PaginaDeNovoTemplate() {
  await exigirAdmin();

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-3 text-sm">
        <Link href="/admin/templates-impressao" className="text-slate-500 hover:text-slate-900">
          ← Templates de impressão
        </Link>
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Novo template</h1>

      <div className="space-y-4">
        <Painel titulo="1. Enviar o PDF" descricao="Envie a arte final do cartão, exatamente como deve ser impressa.">
          <EnvioDeTemplate modo={modoDeEnvio()} limiteBytes={MAX_TEMPLATE_BYTES} />
        </Painel>

        <Painel titulo="Como preparar o arquivo">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Uma única página, com os dois lados do cartão se a arte for assim, e sem rotação de página.</li>
            <li>Um espaço em branco onde o QR Code será colocado. Só o QR é acrescentado: o resto não muda.</li>
            <li>Fontes incorporadas ou convertidas em curvas; sem senha, scripts ou anexos.</li>
            <li>Sangria e marcas, se a gráfica exigir, já devem estar no arquivo.</li>
          </ul>
        </Painel>

        <Painel titulo="Próximas etapas">
          <ol className="space-y-2 text-sm text-slate-600">
            {ETAPAS.map(([titulo, descricao], indice) => (
              <li key={titulo} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                  {indice + 1}
                </span>
                <span>
                  <span className="font-medium text-slate-900">{titulo}.</span> {descricao}
                </span>
              </li>
            ))}
          </ol>
        </Painel>
      </div>
    </div>
  );
}
