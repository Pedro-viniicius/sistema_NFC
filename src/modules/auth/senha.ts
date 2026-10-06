// Hash de senha com scrypt (nativo do Node, sem dependência externa).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const CUSTO = 32768; // N = 2^15
const BLOCO = 8;
const PARALELISMO = 1;
const TAMANHO_DA_CHAVE = 64;
const MEMORIA_MAXIMA = 64 * 1024 * 1024;

export const TAMANHO_MINIMO_DA_SENHA = 12;
export const TAMANHO_MAXIMO_DA_SENHA = 200;

function derivar(senha: string, sal: Buffer, n: number, r: number, p: number, tamanho: number): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha.normalize("NFKC"), sal, tamanho, { N: n, r, p, maxmem: MEMORIA_MAXIMA }, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

/** Formato: scrypt$N$r$p$sal$hash (sal e hash em base64url). */
export async function gerarHashDaSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, CUSTO, BLOCO, PARALELISMO, TAMANHO_DA_CHAVE);
  return ["scrypt", CUSTO, BLOCO, PARALELISMO, sal.toString("base64url"), chave.toString("base64url")].join("$");
}

export async function verificarSenha(senha: string, hashSalvo: string): Promise<boolean> {
  const [algoritmo, n, r, p, sal, chave] = hashSalvo.split("$");
  if (algoritmo !== "scrypt" || !sal || !chave) return false;
  const [custo, bloco, paralelismo] = [Number(n), Number(r), Number(p)];
  if (![custo, bloco, paralelismo].every((valor) => Number.isInteger(valor) && valor > 0)) return false;

  const esperado = Buffer.from(chave, "base64url");
  try {
    const obtido = await derivar(senha, Buffer.from(sal, "base64url"), custo, bloco, paralelismo, esperado.length);
    return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
  } catch {
    return false;
  }
}
