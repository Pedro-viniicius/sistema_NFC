"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", rotulo: "Painel", exato: true },
  { href: "/admin/cartoes", rotulo: "Cartões", exato: false },
  { href: "/admin/lotes", rotulo: "Lotes", exato: false },
  { href: "/admin/contatos", rotulo: "Contatos", exato: false },
  { href: "/admin/templates-impressao", rotulo: "Templates de impressão", exato: false },
  { href: "/admin/artes", rotulo: "Artes", exato: false },
] as const;

export function LinksDeNavegacao({ contatosNovos = 0 }: { contatosNovos?: number }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Navegação principal" className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const ativo = link.exato ? caminho === link.href : caminho.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={ativo ? "page" : undefined}
            className={
              ativo
                ? "rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900"
                : "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }
          >
            {link.rotulo}
            {link.href === "/admin/contatos" && contatosNovos > 0 ? (
              <span
                className="ml-1.5 rounded-full bg-sky-600 px-1.5 py-0.5 text-xs font-semibold text-white"
                aria-label={`${contatosNovos} ${contatosNovos === 1 ? "contato novo" : "contatos novos"}`}
              >
                {contatosNovos}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
