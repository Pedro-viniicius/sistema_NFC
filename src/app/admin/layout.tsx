import type { Metadata } from "next";
import Link from "next/link";
import { LinksDeNavegacao } from "@/components/navegacao";
import { classesDoBotao } from "@/components/ui";
import { obterBanco } from "@/db/cliente";
import { exigirAdmin } from "@/modules/auth/sessao";
import { avisoDaUrlBase } from "@/modules/cards/url-publica";
import { contarContatosNovos } from "@/modules/contacts/servico";
import { sairAction } from "./acoes";

export const metadata: Metadata = { title: "Painel — Cartões NFC" };

export default async function LayoutDoPainel({ children }: LayoutProps<"/admin">) {
  const admin = await exigirAdmin();
  const aviso = avisoDaUrlBase();
  // Contador de contatos ainda não atendidos, mostrado no menu.
  const contatosNovos = await contarContatosNovos(obterBanco());

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/admin" className="text-base font-semibold text-slate-900">
            Cartões NFC
          </Link>
          <LinksDeNavegacao contatosNovos={contatosNovos} />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/admin/ativar" className={classesDoBotao("primario", "py-2")}>
              Ativar cartão
            </Link>
            <form action={sairAction}>
              <button
                type="submit"
                title={admin.email}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      {aviso ? (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {aviso}
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
