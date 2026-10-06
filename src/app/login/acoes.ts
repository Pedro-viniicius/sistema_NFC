"use server";

import { redirect } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { autenticar, esquemaDeCredenciais, type ResultadoDeLogin } from "@/modules/auth/servico";
import { iniciarSessao } from "@/modules/auth/sessao";

export interface EstadoDoLogin {
  erro?: string;
  /** E-mail digitado, devolvido para o formulário não ser limpo após um erro. */
  email?: string;
}

const CREDENCIAIS_INVALIDAS = "E-mail ou senha incorretos.";

export async function entrarAction(_anterior: EstadoDoLogin, formulario: FormData): Promise<EstadoDoLogin> {
  const emailDigitado = formulario.get("email");
  const email = typeof emailDigitado === "string" ? emailDigitado.slice(0, 254) : "";

  const credenciais = esquemaDeCredenciais.safeParse({ email, senha: formulario.get("senha") });
  if (!credenciais.success) return { erro: CREDENCIAIS_INVALIDAS, email };

  let resultado: ResultadoDeLogin;
  try {
    resultado = await autenticar(obterBanco(), credenciais.data.email, credenciais.data.senha);
  } catch (erro) {
    // Nunca registramos e-mail ou senha: apenas a causa técnica.
    registrarLog("erro", "auth.erro_no_login", { mensagem: mensagemDoErro(erro) });
    return { erro: "Não foi possível entrar agora. Tente novamente em instantes.", email };
  }

  if (!resultado.ok) {
    registrarLog("aviso", "auth.login_recusado", { motivo: resultado.motivo });
    return {
      erro:
        resultado.motivo === "BLOQUEADO"
          ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
          : CREDENCIAIS_INVALIDAS,
      email,
    };
  }

  await iniciarSessao(resultado.adminId);
  redirect("/admin");
}
