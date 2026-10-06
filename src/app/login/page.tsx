import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obterAdminAtual } from "@/modules/auth/sessao";
import { FormularioDeLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar — Cartões NFC" };

export default async function PaginaDeLogin() {
  if (await obterAdminAtual()) redirect("/admin");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">Cartões NFC</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">Entre para acessar o painel.</p>
        <FormularioDeLogin />
      </div>
    </main>
  );
}
