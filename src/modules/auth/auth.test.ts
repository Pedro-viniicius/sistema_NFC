import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { administradores } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { gerarHashDaSenha, verificarSenha } from "./senha";
import {
  BLOQUEIO_EM_MINUTOS,
  MAXIMO_DE_TENTATIVAS,
  autenticar,
  criarOuAtualizarAdministrador,
  esquemaDeCredenciais,
} from "./servico";
import { assinarTokenDeSessao, verificarTokenDeSessao } from "./token";

const SENHA = "uma-senha-bem-comprida-123";
const segredo = new TextEncoder().encode("segredo-de-teste-com-mais-de-32-caracteres");

describe("hash de senha", () => {
  it("confere a senha correta e rejeita a errada", async () => {
    const hash = await gerarHashDaSenha(SENHA);
    expect(hash).not.toContain(SENHA);
    expect(await verificarSenha(SENHA, hash)).toBe(true);
    expect(await verificarSenha("outra-senha-qualquer", hash)).toBe(false);
  });

  it("usa sal aleatório e rejeita hash malformado", async () => {
    expect(await gerarHashDaSenha(SENHA)).not.toBe(await gerarHashDaSenha(SENHA));
    expect(await verificarSenha(SENHA, "texto-qualquer")).toBe(false);
    expect(await verificarSenha(SENHA, "")).toBe(false);
  });
});

describe("token de sessão", () => {
  it("valida token assinado com o segredo correto", async () => {
    const token = await assinarTokenDeSessao("admin-1", segredo);
    expect(await verificarTokenDeSessao(token, segredo)).toBe("admin-1");
  });

  it("rejeita token ausente, adulterado, de outro segredo ou expirado", async () => {
    const token = await assinarTokenDeSessao("admin-1", segredo);
    const outroSegredo = new TextEncoder().encode("outro-segredo-com-mais-de-32-caracteres!!");
    expect(await verificarTokenDeSessao(undefined, segredo)).toBeNull();
    expect(await verificarTokenDeSessao(`${token}x`, segredo)).toBeNull();
    expect(await verificarTokenDeSessao(token, outroSegredo)).toBeNull();
    const expirado = await assinarTokenDeSessao("admin-1", segredo, -60);
    expect(await verificarTokenDeSessao(expirado, segredo)).toBeNull();
  });

  it("rejeita token sem assinatura (alg none)", async () => {
    const base64 = (valor: object) => Buffer.from(JSON.stringify(valor)).toString("base64url");
    const falso = `${base64({ alg: "none" })}.${base64({ sub: "admin-1", iss: "sistema-nfc", aud: "painel-admin" })}.`;
    expect(await verificarTokenDeSessao(falso, segredo)).toBeNull();
  });
});

describe("login do administrador", () => {
  let db: Banco;

  beforeAll(async () => {
    db = await criarBancoDeTeste();
    await criarOuAtualizarAdministrador(db, "Admin@Empresa.com.br", SENHA);
  });

  it("autentica com e-mail em qualquer caixa e senha correta", async () => {
    const resultado = await autenticar(db, "ADMIN@empresa.com.br", SENHA);
    expect(resultado.ok).toBe(true);
  });

  it("rejeita senha errada e e-mail desconhecido com a mesma resposta", async () => {
    expect(await autenticar(db, "admin@empresa.com.br", "senha-errada-123")).toEqual({
      ok: false,
      motivo: "CREDENCIAIS_INVALIDAS",
    });
    expect(await autenticar(db, "ninguem@empresa.com.br", SENHA)).toEqual({
      ok: false,
      motivo: "CREDENCIAIS_INVALIDAS",
    });
  });

  it("bloqueia após várias falhas e libera depois do prazo", async () => {
    await criarOuAtualizarAdministrador(db, "bloqueio@empresa.com.br", SENHA);
    const agora = new Date("2026-01-10T12:00:00Z");
    for (let i = 0; i < MAXIMO_DE_TENTATIVAS; i++) {
      await autenticar(db, "bloqueio@empresa.com.br", "senha-errada-123", agora);
    }
    expect(await autenticar(db, "bloqueio@empresa.com.br", SENHA, agora)).toEqual({
      ok: false,
      motivo: "BLOQUEADO",
    });

    const depois = new Date(agora.getTime() + (BLOQUEIO_EM_MINUTOS + 1) * 60_000);
    expect((await autenticar(db, "bloqueio@empresa.com.br", SENHA, depois)).ok).toBe(true);
    const [admin] = await db
      .select()
      .from(administradores)
      .where(eq(administradores.email, "bloqueio@empresa.com.br"));
    expect(admin.tentativasFalhas).toBe(0);
    expect(admin.bloqueadoAte).toBeNull();
  });

  it("redefine a senha de um administrador existente", async () => {
    const primeiro = await criarOuAtualizarAdministrador(db, "troca@empresa.com.br", SENHA);
    const segundo = await criarOuAtualizarAdministrador(db, "troca@empresa.com.br", "nova-senha-comprida-456");
    expect(primeiro.criado).toBe(true);
    expect(segundo.criado).toBe(false);
    expect(segundo.id).toBe(primeiro.id);
    expect((await autenticar(db, "troca@empresa.com.br", SENHA)).ok).toBe(false);
    expect((await autenticar(db, "troca@empresa.com.br", "nova-senha-comprida-456")).ok).toBe(true);
  });

  it("exige senha forte e e-mail válido ao criar administrador", async () => {
    await expect(criarOuAtualizarAdministrador(db, "x@empresa.com.br", "curta")).rejects.toThrow("senha");
    await expect(criarOuAtualizarAdministrador(db, "nao-e-email", SENHA)).rejects.toThrow("E-mail");
  });

  it("valida o formulário de login", () => {
    expect(esquemaDeCredenciais.safeParse({ email: " A@B.com ", senha: "x" }).data?.email).toBe("a@b.com");
    expect(esquemaDeCredenciais.safeParse({ email: "invalido", senha: "x" }).success).toBe(false);
    expect(esquemaDeCredenciais.safeParse({ email: "a@b.com", senha: "" }).success).toBe(false);
  });
});
