import Link from "next/link";
import { obterBanco } from "@/db/cliente";
import { TituloDaPagina, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { listarLotes } from "@/modules/batches/servico";

export default async function PaginaDeLotes() {
  await exigirAdmin();
  const lotes = await listarLotes(obterBanco());

  return (
    <>
      <TituloDaPagina titulo="Lotes">
        <Link href="/admin/lotes/novo" className={classesDoBotao("primario")}>
          Novo lote
        </Link>
      </TituloDaPagina>

      {lotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">Nenhum lote gerado ainda.</p>
          <Link href="/admin/lotes/novo" className={classesDoBotao("primario", "mt-4")}>
            Gerar lote
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Quantidade</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Descrição</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lotes.map((lote) => (
                <tr key={lote.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/lotes/${lote.identificador}`} className="font-mono font-semibold text-slate-900 hover:underline">
                      {lote.identificador}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{lote.quantidade.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-slate-700">{lote.tipo ? rotuloDoTipo(lote.tipo) : "Sem tipo definido"}</td>
                  <td className="hidden max-w-xs truncate px-4 py-3 text-slate-600 sm:table-cell">{lote.descricao ?? "—"}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 sm:table-cell">{formatarDataHora(lote.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
