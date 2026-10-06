import type { Metadata } from "next";
import Link from "next/link";
import { obterBanco } from "@/db/cliente";
import { TituloDaPagina, classesDoBotao, classesDoCampo, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { VERSAO_DO_TEXTO_DE_PRIVACIDADE } from "@/modules/activation/privacidade";
import { formatarWhatsApp, linkDoWhatsApp } from "@/modules/activation/whatsapp";
import { exigirAdmin } from "@/modules/auth/sessao";
import { listarContatos, listarLotesComContatos, quemDecide } from "@/modules/contacts/servico";
import { PAPEL_NO_PAINEL, ROTULO_RAMO, ROTULO_SITUACAO, SITUACOES_DO_CONTATO } from "@/modules/contacts/tipos";
import { SituacaoDoContato } from "./controles";
import { filtroParaConsulta, lerFiltroDeContatos } from "./filtro";

export const metadata: Metadata = { title: "Contatos — Cartões NFC" };

export default async function PaginaDeContatos({ searchParams }: PageProps<"/admin/contatos">) {
  await exigirAdmin();
  const parametros = await searchParams;
  const filtro = lerFiltroDeContatos(parametros);
  const db = obterBanco();
  const [contatos, lotes] = await Promise.all([listarContatos(db, filtro), listarLotesComContatos(db)]);
  const filtrando = Object.values(filtro).some((valor) => valor !== undefined);

  return (
    <>
      <TituloDaPagina titulo="Contatos">
        <a href={`/admin/contatos/exportar${filtroParaConsulta(filtro)}`} className={classesDoBotao("secundario")}>
          Exportar CSV
        </a>
      </TituloDaPagina>

      <p className="mb-4 text-sm text-slate-600">
        Quem ativou o próprio cartão deixou estes dados. Use o WhatsApp de quem aceitou receber ofertas para oferecer
        outros produtos; os demais contatos servem só para dar suporte ao cartão.
      </p>

      {parametros.excluido ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Dados do contato excluídos. O cartão continua ativo.
        </p>
      ) : null}

      <form className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <input
          name="q"
          type="search"
          defaultValue={filtro.busca ?? ""}
          placeholder="Loja, nome, WhatsApp ou cartão"
          aria-label="Buscar contato"
          className={classesDoCampo("lg:col-span-2")}
        />
        <select name="lote" defaultValue={filtro.lote ?? ""} aria-label="Lote" className={classesDoCampo()}>
          <option value="">Todos os lotes</option>
          {lotes.map((lote) => (
            <option key={lote} value={lote}>
              {lote}
            </option>
          ))}
        </select>
        <select name="situacao" defaultValue={filtro.situacao ?? ""} aria-label="Situação" className={classesDoCampo()}>
          <option value="">Todas as situações</option>
          {SITUACOES_DO_CONTATO.map((situacao) => (
            <option key={situacao} value={situacao}>
              {ROTULO_SITUACAO[situacao]}
            </option>
          ))}
        </select>
        <select
          name="ofertas"
          defaultValue={filtro.aceitouOfertas === undefined ? "" : filtro.aceitouOfertas ? "sim" : "nao"}
          aria-label="Aceite de ofertas"
          className={classesDoCampo()}
        >
          <option value="">Aceitou ofertas: todos</option>
          <option value="sim">Aceitou ofertas: sim</option>
          <option value="nao">Aceitou ofertas: não</option>
        </select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className={classesDoBotao("primario")}>
            Filtrar
          </button>
          {filtrando ? (
            <Link href="/admin/contatos" className={classesDoBotao("secundario")}>
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      {contatos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          {filtrando ? (
            "Nenhum contato com esses filtros."
          ) : (
            <>
              <p>Nenhum contato ainda.</p>
              <p className="mt-2 text-sm">
                Eles aparecem aqui quando um cliente ativa o próprio cartão. Para liberar, abra o lote e ligue a opção{" "}
                <strong>Ativação pelo cliente</strong>.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Loja</th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Quem decide</th>
                <th className="px-4 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3 font-medium">Ramo</th>
                <th className="px-4 py-3 font-medium">Cartão</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Ativado em</th>
                <th className="px-4 py-3 font-medium">Ofertas</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contatos.map((contato) => (
                <tr key={contato.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/contatos/${contato.id}`} className="font-semibold text-slate-900 hover:underline">
                      {contato.loja}
                    </Link>
                    {contato.cartoesDaLoja > 1 ? (
                      <p className="mt-0.5 text-xs font-medium text-violet-700">
                        Esta loja tem {contato.cartoesDaLoja} cartões
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {contato.nome}
                    <span className="block text-xs text-slate-500">{PAPEL_NO_PAINEL[contato.papel]}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{quemDecide(contato)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="tabular-nums text-slate-700">{formatarWhatsApp(contato.whatsapp)}</span>
                    <a
                      href={linkDoWhatsApp(contato.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block text-xs font-medium text-emerald-700 underline underline-offset-2"
                    >
                      Abrir conversa no WhatsApp
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{contato.ramo ? ROTULO_RAMO[contato.ramo] : "—"}</td>
                  <td className="px-4 py-3">
                    {contato.cartaoId ? (
                      <Link href={`/admin/cartoes/${contato.cartaoCodigo}`} className="font-mono font-semibold text-slate-900 hover:underline">
                        {contato.cartaoCodigo}
                      </Link>
                    ) : (
                      <span className="font-mono text-slate-400" title="O cartão foi apagado">
                        {contato.cartaoCodigo}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-700">{contato.loteIdentificador ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{rotuloDoTipo(contato.tipo)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatarDataHora(contato.registradoEm)}</td>
                  <td className="px-4 py-3">
                    {contato.aceitouOfertas ? (
                      <span className="font-medium text-emerald-700">Sim</span>
                    ) : (
                      <span className="text-slate-500">Não</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SituacaoDoContato id={contato.id} situacao={contato.situacao} loja={contato.loja} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Rascunho a revisar:</strong> o texto{" "}
        <Link href="/privacidade" target="_blank" className="underline underline-offset-2">
          Como usamos seus dados
        </Link>{" "}
        (versão <span className="font-mono">{VERSAO_DO_TEXTO_DE_PRIVACIDADE}</span>) mostrado aos clientes ainda é um
        rascunho. Revise-o antes de liberar a ativação pelo cliente para muitos cartões. Se alguém pedir a exclusão dos
        dados, abra o contato e use <strong>Excluir dados do contato</strong>.
      </p>
    </>
  );
}
