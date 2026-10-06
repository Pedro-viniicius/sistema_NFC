import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { SeloDeStatus, TituloDaPagina, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { ErroDeDominio } from "@/lib/erros";
import { exigirAdmin } from "@/modules/auth/sessao";
import { buscarLotePorIdentificador } from "@/modules/batches/servico";
import { listarCartoesDoLote } from "@/modules/cards/repositorio";
import { getCardPublicUrl } from "@/modules/cards/url-publica";

export default async function PaginaDoLote({ params }: PageProps<"/admin/lotes/[identificador]">) {
  await exigirAdmin();
  const { identificador } = await params;
  const db = obterBanco();

  const lote = await buscarLotePorIdentificador(db, identificador).catch((erro: unknown) => {
    if (erro instanceof ErroDeDominio) return null;
    throw erro;
  });
  if (!lote) notFound();

  const cartoes = await listarCartoesDoLote(db, lote.id);
  const exportar = `/admin/lotes/${lote.identificador}/exportar`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/lotes" className="text-slate-500 hover:text-slate-900">
          ← Lotes
        </Link>
      </p>
      <TituloDaPagina titulo={lote.identificador}>
        <a href={`${exportar}?formato=zip`} className={classesDoBotao("primario")}>
          Baixar QR Codes (ZIP)
        </a>
        <a href={`${exportar}?formato=csv`} className={classesDoBotao("secundario")}>
          Exportar CSV
        </a>
      </TituloDaPagina>

      <p className="mb-4 text-sm text-slate-600">
        {cartoes.length.toLocaleString("pt-BR")} {cartoes.length === 1 ? "cartão" : "cartões"} ·{" "}
        {lote.tipo ? rotuloDoTipo(lote.tipo) : "Sem tipo definido"} · criado em {formatarDataHora(lote.criadoEm)}
        {lote.descricao ? ` · ${lote.descricao}` : ""}
      </p>
      <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
        O ZIP contém a pasta <code className="font-mono">{lote.identificador}/</code> com um SVG por cartão
        (<code className="font-mono">CODIGO.svg</code>) e o arquivo <code className="font-mono">lote.csv</code>.
        Envie à gráfica e grave no NFC a mesma URL permanente de cada linha.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">URL permanente</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cartoes.map((cartao) => (
              <tr key={cartao.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/cartoes/${cartao.codigo}`} className="font-mono font-semibold text-slate-900 hover:underline">
                    {cartao.codigo}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{getCardPublicUrl(cartao.codigo)}</td>
                <td className="px-4 py-2.5 text-slate-700">{rotuloDoTipo(cartao.tipo)}</td>
                <td className="px-4 py-2.5">
                  <SeloDeStatus status={cartao.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
