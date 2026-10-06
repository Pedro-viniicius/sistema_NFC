// Constantes e tipos do domínio de cartões. Sem dependências: pode ser usado no servidor e no cliente.

export const STATUS_CARTAO = ["NAO_CONFIGURADO", "ATIVO", "INATIVO"] as const;
export type StatusCartao = (typeof STATUS_CARTAO)[number];

export const TIPOS_DESTINO = ["INSTAGRAM", "GOOGLE", "GENERICO"] as const;
export type TipoDestino = (typeof TIPOS_DESTINO)[number];

export const ROTULO_STATUS: Record<StatusCartao, string> = {
  NAO_CONFIGURADO: "Não configurado",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
};

export const ROTULO_TIPO: Record<TipoDestino, string> = {
  INSTAGRAM: "Instagram",
  GOOGLE: "Google",
  GENERICO: "Outro link",
};

export function ehStatusCartao(valor: unknown): valor is StatusCartao {
  return typeof valor === "string" && (STATUS_CARTAO as readonly string[]).includes(valor);
}

export function ehTipoDestino(valor: unknown): valor is TipoDestino {
  return typeof valor === "string" && (TIPOS_DESTINO as readonly string[]).includes(valor);
}
