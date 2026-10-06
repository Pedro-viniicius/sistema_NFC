// Regras de autenticação dos administradores (independentes de cookies e do Next.js).
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { administradores, type Administrador } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import {
  TAMANHO_MAXIMO_DA_SENHA,
  TAMANHO_MINIMO_DA_SENHA,
  gerarHashDaSenha,
  verificarSenha,
} from "./senha";

export const MAXIMO_DE_TENTATIVAS = 5;
export const BLOQUEIO_EM_MINUTOS = 15;

export const esquemaDeCredenciais = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Informe um e-mail válido.").max(254)),
  senha: z.string().min(1, "Informe a senha.").max(TAMANHO_MAXIMO_DA_SENHA),
});

export type ResultadoDeLogin =
  | { ok: true; adminId: string }
  | { ok: false; motivo: "CREDENCIAIS_INVALIDAS" | "BLOQUEADO" };

// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar quais e-mails são válidos.
let hashFicticio: Promise<string> | undefined;

export async function buscarAdministradorPorId(db: Banco, id: string): Promise<Administrador | null> {
  const [admin] = await db.select().from(administradores).where(eq(administradores.id, id)).limit(1);
  return admin ?? null;
}

/**
 * Confere e-mail e senha. Após várias falhas seguidas a conta fica bloqueada por alguns minutos,
 * o que inviabiliza adivinhar a senha por tentativa e erro.
 */
export async function autenticar(
  db: Banco,
  email: string,
  senha: string,
  agora: Date = new Date(),
): Promise<ResultadoDeLogin> {
  const [admin] = await db
    .select()
    .from(administradores)
    .where(eq(administradores.email, email.trim().toLowerCase()))
    .limit(1);

  if (!admin) {
    hashFicticio ??= gerarHashDaSenha("senha-ficticia-apenas-para-igualar-o-tempo");
    await verificarSenha(senha, await hashFicticio);
    return { ok: false, motivo: "CREDENCIAIS_INVALIDAS" };
  }

  if (admin.bloqueadoAte && admin.bloqueadoAte > agora) {
    return { ok: false, motivo: "BLOQUEADO" };
  }

  if (await verificarSenha(senha, admin.senhaHash)) {
    if (admin.tentativasFalhas > 0 || admin.bloqueadoAte) {
      await db
        .update(administradores)
        .set({ tentativasFalhas: 0, bloqueadoAte: null })
        .where(eq(administradores.id, admin.id));
    }
    return { ok: true, adminId: admin.id };
  }

  const [{ tentativas }] = await db
    .update(administradores)
    .set({ tentativasFalhas: sql`${administradores.tentativasFalhas} + 1` })
    .where(eq(administradores.id, admin.id))
    .returning({ tentativas: administradores.tentativasFalhas });

  if (tentativas >= MAXIMO_DE_TENTATIVAS) {
    await db
      .update(administradores)
      .set({
        tentativasFalhas: 0,
        bloqueadoAte: new Date(agora.getTime() + BLOQUEIO_EM_MINUTOS * 60_000),
      })
      .where(eq(administradores.id, admin.id));
  }
  return { ok: false, motivo: "CREDENCIAIS_INVALIDAS" };
}

/** Cria o administrador ou, se o e-mail já existir, redefine a senha e remove o bloqueio. */
export async function criarOuAtualizarAdministrador(
  db: Banco,
  email: string,
  senha: string,
): Promise<{ id: string; email: string; criado: boolean }> {
  const emailValido = z.email().max(254).safeParse(email.trim().toLowerCase());
  if (!emailValido.success) {
    throw new ErroDeDominio("ENTRADA_INVALIDA", "E-mail inválido.");
  }
  if (senha.length < TAMANHO_MINIMO_DA_SENHA || senha.length > TAMANHO_MAXIMO_DA_SENHA) {
    throw new ErroDeDominio(
      "ENTRADA_INVALIDA",
      `A senha deve ter entre ${TAMANHO_MINIMO_DA_SENHA} e ${TAMANHO_MAXIMO_DA_SENHA} caracteres.`,
    );
  }

  const senhaHash = await gerarHashDaSenha(senha);
  const [admin] = await db
    .insert(administradores)
    .values({ email: emailValido.data, senhaHash })
    .onConflictDoUpdate({
      target: administradores.email,
      set: { senhaHash, tentativasFalhas: 0, bloqueadoAte: null },
    })
    .returning({
      id: administradores.id,
      email: administradores.email,
      // xmax = 0 só em linhas recém-inseridas: distingue criação de atualização.
      criado: sql<boolean>`(xmax = 0)`,
    });
  return admin;
}
