// Leitura centralizada das variáveis de ambiente secretas (somente servidor).
// A validação é feita na primeira leitura, para não quebrar o build quando a variável ainda não existe.

export class ErroDeConfiguracao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeConfiguracao";
  }
}

export function emProducao(): boolean {
  return process.env.NODE_ENV === "production";
}

export function obterDatabaseUrl(): string {
  const valor = process.env.DATABASE_URL?.trim();
  if (!valor) {
    throw new ErroDeConfiguracao("A variável DATABASE_URL não está definida.");
  }
  return valor;
}

export function obterAuthSecret(): Uint8Array {
  const valor = process.env.AUTH_SECRET?.trim();
  if (!valor || valor.length < 32) {
    throw new ErroDeConfiguracao("A variável AUTH_SECRET deve ter pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(valor);
}
