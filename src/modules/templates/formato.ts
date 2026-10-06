// Formatação e leitura de números no padrão brasileiro (vírgula decimal). Seguro para o cliente.

/** Ex.: 130.05 → "130,05". */
export function formatarMm(valor: number, casas = 2): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Ex.: (130.05, 86.7) → "130,05 × 86,70 mm". */
export function formatarDimensoesMm(larguraMm: number, alturaMm: number): string {
  return `${formatarMm(larguraMm)} × ${formatarMm(alturaMm)} mm`;
}

/**
 * Lê um número digitado com vírgula ou ponto decimal ("82,5", "82.5", " 82,50 ").
 * Devolve null quando o texto não é um número.
 */
export function lerNumero(texto: unknown): number | null {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : null;
  if (typeof texto !== "string") return null;
  const limpo = texto.trim().replace(/\s+/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(limpo)) return null;
  const numero = Number(limpo.replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

export function tamanhoLegivel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
    : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

/** Trecho seguro para nomes de arquivo, ex.: "Google — Modelo 01" → "google-modelo-01". */
export function slugDoNome(nome: string): string {
  const slug = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "template";
}
