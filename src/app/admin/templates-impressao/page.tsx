import type { Metadata } from "next";
import Link from "next/link";
import { obterBanco } from "@/db/cliente";
import { TituloDaPagina, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { formatarDimensoesMm } from "@/modules/templates/formato";
import { listarTemplates } from "@/modules/templates/servico";
import { AcoesDoTemplate } from "./acoes-do-template";
import { SeloDePadrao, SeloDoTemplate } from "./selo";

export const metadata: Metadata = { title: "Templates de impressão — Cartões NFC" };

// As ações desta página (testar, ativar, duplicar) leem o PDF do template no armazenamento e geram
// o PDF final. Medido: poucos segundos mesmo com um template de 25 MB; o teto dá folga.
export const maxDuration = 60;

const LINK = "font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900";

export default async function PaginaDeTemplates() {
  await exigirAdmin();
  const templates = await listarTemplates(obterBanco());

  return (
    <>
      <TituloDaPagina titulo="Templates de impressão">
        <Link href="/admin/templates-impressao/novo" className={classesDoBotao("primario")}>
          Novo template
        </Link>
      </TituloDaPagina>

      <p className="mb-4 text-sm text-slate-600">
        O template é a arte final do cartão, em PDF, com um espaço em branco para o QR Code. O sistema não altera a
        arte: só acrescenta o QR de cada cartão na área que você indicar.
      </p>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">Nenhum template enviado ainda.</p>
          <Link href="/admin/templates-impressao/novo" className={classesDoBotao("primario", "mt-4")}>
            Enviar o primeiro template
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Dimensões</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Padrão</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Última atualização</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((template) => {
                const pagina = `/admin/templates-impressao/${template.id}`;
                return (
                  <tr key={template.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={pagina} className="font-semibold text-slate-900 hover:underline">
                        {template.nome}
                      </Link>
                      {template.lotes > 0 ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          Em uso por {template.lotes} {template.lotes === 1 ? "lote" : "lotes"}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-slate-500 md:hidden">
                        {formatarDimensoesMm(template.larguraDaPaginaMm, template.alturaDaPaginaMm)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{template.tipo ? rotuloDoTipo(template.tipo) : "A definir"}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 md:table-cell">
                      {formatarDimensoesMm(template.larguraDaPaginaMm, template.alturaDaPaginaMm)}
                    </td>
                    <td className="px-4 py-3">
                      <SeloDoTemplate status={template.status} />
                      {template.padrao ? (
                        <span className="ml-1 sm:hidden">
                          <SeloDePadrao />
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{template.padrao ? <SeloDePadrao /> : "—"}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 lg:table-cell">
                      {formatarDataHora(template.atualizadoEm)}
                    </td>
                    <td className="space-y-2 px-4 py-3">
                      <p className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link href={pagina} className={LINK}>
                          Visualizar
                        </Link>
                        <Link href={`${pagina}#qr`} className={LINK}>
                          Configurar QR
                        </Link>
                        <Link href={`${pagina}#teste`} className={LINK}>
                          Testar QR
                        </Link>
                        <Link href={`${pagina}#dados`} className={LINK}>
                          Editar
                        </Link>
                      </p>
                      <AcoesDoTemplate
                        id={template.id}
                        nome={template.nome}
                        status={template.status}
                        padrao={template.padrao}
                        podeExcluir={template.lotes === 0}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
