import Link from "next/link";
import { obterBanco } from "@/db/cliente";
import { Painel, TituloDaPagina, classesDoBotao, classesDoCampo } from "@/components/ui";
import { exigirAdmin } from "@/modules/auth/sessao";
import { obterEstatisticas } from "@/modules/cards/repositorio";
import { contarContatosNovos } from "@/modules/contacts/servico";

interface Indicador {
  rotulo: string;
  valor: number;
  href: string;
}

export default async function PaginaDoPainel() {
  await exigirAdmin();
  const db = obterBanco();
  const [estatisticas, contatosNovos] = await Promise.all([obterEstatisticas(db), contarContatosNovos(db)]);

  const indicadores: Indicador[] = [
    { rotulo: "Total de cartões", valor: estatisticas.total, href: "/admin/cartoes" },
    { rotulo: "Não configurados", valor: estatisticas.naoConfigurados, href: "/admin/cartoes?status=NAO_CONFIGURADO" },
    { rotulo: "Ativos", valor: estatisticas.ativos, href: "/admin/cartoes?status=ATIVO" },
    { rotulo: "Inativos", valor: estatisticas.inativos, href: "/admin/cartoes?status=INATIVO" },
    { rotulo: "Instagram", valor: estatisticas.instagram, href: "/admin/cartoes?tipo=INSTAGRAM" },
    { rotulo: "Google", valor: estatisticas.google, href: "/admin/cartoes?tipo=GOOGLE" },
  ];

  return (
    <>
      <TituloDaPagina titulo="Painel" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/ativar" className={classesDoBotao("primario", "py-4 text-base")}>
          Ativar cartão
        </Link>
        <Link href="/admin/lotes/novo" className={classesDoBotao("secundario", "py-4 text-base")}>
          Novo lote
        </Link>
        <Link href="/admin/cartoes" className={classesDoBotao("secundario", "py-4 text-base")}>
          Ver cartões
        </Link>
      </div>

      {contatosNovos > 0 ? (
        <Link
          href="/admin/contatos?situacao=NOVO"
          className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900 hover:border-sky-400"
        >
          <span>
            <strong>
              {contatosNovos} {contatosNovos === 1 ? "contato novo" : "contatos novos"}
            </strong>{" "}
            de clientes que ativaram o próprio cartão.
          </span>
          <span className="whitespace-nowrap font-medium underline underline-offset-2">Ver contatos</span>
        </Link>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {indicadores.map((indicador) => (
          <Link
            key={indicador.rotulo}
            href={indicador.href}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400"
          >
            <p className="text-sm text-slate-500">{indicador.rotulo}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {indicador.valor.toLocaleString("pt-BR")}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Painel titulo="Encontrar cartão" descricao="Busque por código, destino ou descrição.">
          <form action="/admin/cartoes" className="flex gap-2">
            <input
              name="q"
              type="search"
              placeholder="Ex.: K8M4T2 ou instagram.com/empresa"
              aria-label="Buscar cartão"
              className={classesDoCampo()}
            />
            <button type="submit" className={classesDoBotao("primario")}>
              Buscar
            </button>
          </form>
        </Painel>
      </div>
    </>
  );
}
