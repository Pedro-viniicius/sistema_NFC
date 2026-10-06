import Link from "next/link";
import { obterBanco } from "@/db/cliente";
import { SeloDeStatus, TituloDaPagina, classesDoBotao, classesDoCampo, rotuloDoTipo } from "@/components/ui";
import { formatarData } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { listarCartoes } from "@/modules/cards/repositorio";
import {
  ROTULO_STATUS,
  ROTULO_TIPO,
  STATUS_CARTAO,
  TIPOS_DESTINO,
  ehStatusCartao,
  ehTipoDestino,
} from "@/modules/cards/tipos";

const POR_PAGINA = 50;

function primeiroValor(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

export default async function PaginaDeCartoes({ searchParams }: PageProps<"/admin/cartoes">) {
  await exigirAdmin();
  const parametros = await searchParams;

  const busca = primeiroValor(parametros.q).trim().slice(0, 200);
  const statusBruto = primeiroValor(parametros.status);
  const tipoBruto = primeiroValor(parametros.tipo);
  const status = ehStatusCartao(statusBruto) ? statusBruto : undefined;
  const tipo = ehTipoDestino(tipoBruto) ? tipoBruto : undefined;
  const paginaPedida = Number.parseInt(primeiroValor(parametros.pagina), 10);
  const pagina = Number.isInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida : 1;

  const resultado = await listarCartoes(obterBanco(), {
    busca,
    status,
    tipo,
    pagina,
    porPagina: POR_PAGINA,
  });
  const totalDePaginas = Math.max(Math.ceil(resultado.total / POR_PAGINA), 1);

  function linkDaPagina(numero: number): string {
    const consulta = new URLSearchParams();
    if (busca) consulta.set("q", busca);
    if (status) consulta.set("status", status);
    if (tipo) consulta.set("tipo", tipo);
    if (numero > 1) consulta.set("pagina", String(numero));
    const texto = consulta.toString();
    return texto ? `/admin/cartoes?${texto}` : "/admin/cartoes";
  }

  const temFiltro = Boolean(busca || status || tipo);

  return (
    <>
      <TituloDaPagina titulo="Cartões">
        <Link href="/admin/lotes/novo" className={classesDoBotao("secundario")}>
          Novo lote
        </Link>
      </TituloDaPagina>

      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          name="q"
          type="search"
          defaultValue={busca}
          placeholder="Buscar por código, destino ou descrição"
          aria-label="Buscar"
          className={classesDoCampo()}
        />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={classesDoCampo("sm:w-44")}>
          <option value="">Todos os status</option>
          {STATUS_CARTAO.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROTULO_STATUS[opcao]}
            </option>
          ))}
        </select>
        <select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo" className={classesDoCampo("sm:w-40")}>
          <option value="">Todos os tipos</option>
          {TIPOS_DESTINO.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROTULO_TIPO[opcao]}
            </option>
          ))}
        </select>
        <button type="submit" className={classesDoBotao("primario")}>
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        {resultado.total.toLocaleString("pt-BR")} {resultado.total === 1 ? "cartão" : "cartões"}
        {temFiltro ? (
          <>
            {" · "}
            <Link href="/admin/cartoes" className="underline hover:text-slate-900">
              Limpar filtros
            </Link>
          </>
        ) : null}
      </p>

      {resultado.itens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">
            {temFiltro ? "Nenhum cartão encontrado com esses filtros." : "Nenhum cartão cadastrado ainda."}
          </p>
          {!temFiltro ? (
            <Link href="/admin/lotes/novo" className={classesDoBotao("primario", "mt-4")}>
              Gerar o primeiro lote
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Destino</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Data de criação</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Data de ativação</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resultado.itens.map((cartao) => (
                <tr key={cartao.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/cartoes/${cartao.codigo}`}
                      className="font-mono text-base font-semibold text-slate-900 hover:underline"
                    >
                      {cartao.codigo}
                    </Link>
                    {cartao.descricao ? (
                      <p className="max-w-[14rem] truncate text-xs text-slate-500">{cartao.descricao}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{rotuloDoTipo(cartao.tipo)}</td>
                  <td className="hidden max-w-xs px-4 py-3 text-slate-700 md:table-cell">
                    <span className="block truncate" title={cartao.destinoUrl ?? undefined}>
                      {cartao.destinoUrl ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SeloDeStatus status={cartao.status} />
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 lg:table-cell">
                    {formatarData(cartao.criadoEm)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 lg:table-cell">
                    {formatarData(cartao.ativadoEm)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">
                    <Link
                      href={`/admin/ativar?codigo=${cartao.codigo}`}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {cartao.destinoUrl ? "Alterar destino" : "Configurar"}
                    </Link>
                    <span className="mx-2 text-slate-300">|</span>
                    <Link
                      href={`/admin/cartoes/${cartao.codigo}`}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalDePaginas > 1 ? (
        <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-sm">
          {pagina > 1 ? (
            <Link href={linkDaPagina(pagina - 1)} className={classesDoBotao("secundario")}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Página {Math.min(pagina, totalDePaginas)} de {totalDePaginas}
          </span>
          {pagina < totalDePaginas ? (
            <Link href={linkDaPagina(pagina + 1)} className={classesDoBotao("secundario")}>
              Próxima
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
