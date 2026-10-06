type Nivel = "info" | "aviso" | "erro";

type DadosDeLog = Record<string, string | number | boolean | null | undefined>;

/**
 * Log estruturado simples (uma linha JSON), legível nos logs da Vercel.
 * Nunca passe senhas, tokens, cookies ou a DATABASE_URL em `dados`.
 */
export function registrarLog(nivel: Nivel, evento: string, dados: DadosDeLog = {}): void {
  const linha = JSON.stringify({ nivel, evento, ...dados, em: new Date().toISOString() });
  if (nivel === "erro") {
    console.error(linha);
  } else if (nivel === "aviso") {
    console.warn(linha);
  } else {
    console.info(linha);
  }
}

export function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : "erro desconhecido";
}
