// Conversão de unidades físicas para o PDF. O PDF mede em pontos: 72 pontos por polegada.

export const MM_POR_POLEGADA = 25.4;
export const PONTOS_POR_POLEGADA = 72;

export function mmParaPontos(mm: number): number {
  return (mm * PONTOS_POR_POLEGADA) / MM_POR_POLEGADA;
}

export function pontosParaMm(pontos: number): number {
  return (pontos * MM_POR_POLEGADA) / PONTOS_POR_POLEGADA;
}
