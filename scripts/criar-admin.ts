// Cria um administrador do painel (ou redefine a senha, se o e-mail já existir).
//
// Uso:
//   pnpm admin:criar admin@empresa.com.br
//
// A senha é pedida no terminal (sem aparecer na tela). Em ambientes sem terminal interativo,
// informe-a pela variável ADMIN_SENHA.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { ErroDeDominio } from "../src/lib/erros";
import { criarOuAtualizarAdministrador } from "../src/modules/auth/servico";

function lerSenhaOculta(pergunta: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const entrada = process.stdin;
    process.stdout.write(pergunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding("utf8");

    let senha = "";
    const aoDigitar = (trecho: string) => {
      for (const caractere of trecho) {
        if (caractere === "\r" || caractere === "\n") {
          entrada.setRawMode(false);
          entrada.pause();
          entrada.off("data", aoDigitar);
          process.stdout.write("\n");
          resolver(senha);
          return;
        }
        if (caractere === "\u0003") {
          entrada.setRawMode(false);
          process.stdout.write("\n");
          rejeitar(new Error("Operação cancelada."));
          return;
        }
        if (caractere === "\u007f" || caractere === "\b") senha = senha.slice(0, -1);
        else senha += caractere;
      }
    };
    entrada.on("data", aoDigitar);
  });
}

async function obterSenha(): Promise<string> {
  if (process.env.ADMIN_SENHA) return process.env.ADMIN_SENHA;
  if (!process.stdin.isTTY) {
    throw new Error("Sem terminal interativo: informe a senha pela variável ADMIN_SENHA.");
  }
  const senha = await lerSenhaOculta("Senha (mínimo 12 caracteres): ");
  const confirmacao = await lerSenhaOculta("Confirme a senha: ");
  if (senha !== confirmacao) throw new Error("As senhas não conferem.");
  return senha;
}

async function principal(): Promise<void> {
  const email = process.argv[2] ?? process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error("Informe o e-mail: pnpm admin:criar admin@empresa.com.br");
  }
  const urlDoBanco = process.env.DATABASE_URL;
  if (!urlDoBanco) {
    throw new Error("A variável DATABASE_URL não está definida (confira o .env.local).");
  }

  const senha = await obterSenha();
  const pool = new Pool({ connectionString: urlDoBanco, max: 1 });
  try {
    const admin = await criarOuAtualizarAdministrador(drizzle(pool, { schema }), email, senha);
    console.log(
      admin.criado
        ? `Administrador criado: ${admin.email}`
        : `Senha redefinida para o administrador: ${admin.email}`,
    );
  } finally {
    await pool.end();
  }
}

principal().catch((erro: unknown) => {
  const mensagem = erro instanceof ErroDeDominio || erro instanceof Error ? erro.message : String(erro);
  console.error(`Erro: ${mensagem}`);
  process.exitCode = 1;
});
