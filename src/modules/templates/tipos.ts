// Constantes e tipos dos templates de impressão. Sem dependências: pode ser usado no servidor e no cliente.

export const STATUS_TEMPLATE = ["RASCUNHO", "PRONTO", "INATIVO"] as const;
export type StatusTemplate = (typeof STATUS_TEMPLATE)[number];

export const ROTULO_STATUS_TEMPLATE: Record<StatusTemplate, string> = {
  RASCUNHO: "Rascunho",
  PRONTO: "Pronto",
  INATIVO: "Inativo",
};

/**
 * Caixa de página do PDF, em pontos, no espaço do usuário da página: [x0, y0, x1, y1],
 * com origem no canto INFERIOR esquerdo e sempre normalizada (x0 < x1, y0 < y1).
 * A origem pode não ser (0, 0).
 */
export type CaixaPt = [x0: number, y0: number, x1: number, y1: number];

/** Retângulo em pontos no espaço do usuário da página (origem embaixo, à esquerda). */
export interface RetanguloPt {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Posição do QR em um template: a área escolhida pelo administrador e a zona de silêncio. */
export interface ConfiguracaoDoQr {
  area: RetanguloPt;
  /** Margem clara em volta do QR, em módulos, DENTRO do quadrado do QR. */
  zonaDeSilencioModulos: number;
}

export const ZONA_DE_SILENCIO_PADRAO = 4;
export const ZONA_DE_SILENCIO_MINIMA = 2;
export const ZONA_DE_SILENCIO_MAXIMA = 10;
