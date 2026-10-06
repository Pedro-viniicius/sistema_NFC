// Telefone de contato (WhatsApp) no padrão brasileiro. Usado na ativação e no painel.

/** DDDs em uso no Brasil. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type ResultadoDoWhatsApp = { ok: true; numero: string } | { ok: false; erro: string };

const ERRO_DE_FORMATO = "Confira o número: DDD e telefone, como (11) 91234-5678.";

/**
 * Aceita o número como a pessoa digita — com ou sem parênteses, traço, espaços, +55 ou zero na
 * frente — e devolve no formato internacional: +55 + DDD + número.
 * Vale celular (9 dígitos, começando com 9) e fixo (8 dígitos, começando de 2 a 5), porque o
 * WhatsApp Business também funciona em telefone fixo.
 */
export function normalizarWhatsApp(entrada: unknown): ResultadoDoWhatsApp {
  if (typeof entrada !== "string" || entrada.trim().length === 0) {
    return { ok: false, erro: "Informe o WhatsApp com DDD." };
  }
  let digitos = entrada.replace(/\D/g, "");
  if (digitos.length >= 12 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length >= 11 && digitos.startsWith("0")) digitos = digitos.slice(1);
  if (digitos.length !== 10 && digitos.length !== 11) return { ok: false, erro: ERRO_DE_FORMATO };

  const ddd = Number(digitos.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) {
    return { ok: false, erro: `O DDD ${digitos.slice(0, 2)} não existe. Confira o número.` };
  }
  const numero = digitos.slice(2);
  const celular = numero.length === 9 && numero.startsWith("9");
  const fixo = numero.length === 8 && /^[2-5]/.test(numero);
  if (!celular && !fixo) return { ok: false, erro: ERRO_DE_FORMATO };
  if (/^(\d)\1+$/.test(numero)) return { ok: false, erro: ERRO_DE_FORMATO };

  return { ok: true, numero: `+55${digitos}` };
}

/** "+5511912345678" → "(11) 91234-5678". Devolve o texto original se não estiver no formato esperado. */
export function formatarWhatsApp(numero: string): string {
  const partes = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(numero);
  return partes ? `(${partes[1]}) ${partes[2]}-${partes[3]}` : numero;
}

/** Link para abrir a conversa no WhatsApp (wa.me exige o número só com dígitos, com o código do país). */
export function linkDoWhatsApp(numero: string, mensagem?: string): string {
  const base = `https://wa.me/${numero.replace(/\D/g, "")}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}
