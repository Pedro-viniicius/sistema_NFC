"use client";

import { useActionState } from "react";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import { entrarAction, type EstadoDoLogin } from "./acoes";

const estadoInicial: EstadoDoLogin = {};

export function FormularioDeLogin() {
  const [estado, enviar, pendente] = useActionState(entrarAction, estadoInicial);

  return (
    <form action={enviar} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={estado.email}
          required
          autoFocus={!estado.email}
          className={classesDoCampo()}
        />
      </div>
      <div>
        <label htmlFor="senha" className="mb-1 block text-sm font-medium text-slate-700">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={Boolean(estado.email)}
          className={classesDoCampo()}
        />
      </div>
      {estado.erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      ) : null}
      <button type="submit" disabled={pendente} className={classesDoBotao("primario", "w-full")}>
        {pendente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
