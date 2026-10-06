// Código público permanente do cartão. Único ponto do sistema que gera e valida códigos.

/** 31 caracteres: sem 0/O e sem 1/I/L, que se confundem na leitura e na digitação. */
export const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const COMPRIMENTO_CODIGO = 6;

const FORMATO_CODIGO = new RegExp(`^[${ALFABETO_CODIGO}]{${COMPRIMENTO_CODIGO}}$`);

/** Devolve um inteiro uniforme em [0, limite). */
export type FonteAleatoria = (limite: number) => number;

/** Fonte criptográfica (Web Crypto), com amostragem por rejeição para não enviesar o sorteio. */
const fonteCriptografica: FonteAleatoria = (limite) => {
  const teto = 256 - (256 % limite);
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0] < teto) return byte[0] % limite;
  }
};

export function gerarCodigo(aleatorio: FonteAleatoria = fonteCriptografica): string {
  let codigo = "";
  for (let i = 0; i < COMPRIMENTO_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[aleatorio(ALFABETO_CODIGO.length)];
  }
  return codigo;
}

export function codigoValido(codigo: string): boolean {
  return FORMATO_CODIGO.test(codigo);
}

/** Aceita o código digitado (com espaços ou minúsculas) e devolve a forma canônica, ou null. */
export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const codigo = entrada.trim().toUpperCase();
  return codigoValido(codigo) ? codigo : null;
}

/**
 * Como `normalizarCodigo`, mas também aceita a URL permanente colada ou lida por um leitor
 * de QR Code (ex.: https://go.dominio.com/c/K8M4T2).
 */
export function extrairCodigo(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const daUrl = /\/c\/([^/?#\s]+)/i.exec(entrada);
  return normalizarCodigo(daUrl ? daUrl[1] : entrada);
}
