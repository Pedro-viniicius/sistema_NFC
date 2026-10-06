// Geometria do QR dentro da área configurada. Pura: usada pelo gerador de PDF e pelo editor do painel,
// para que o tamanho mostrado ao administrador seja exatamente o que será impresso.
import { ptToMm } from "./coordenadas";
import type { ConfiguracaoDoQr } from "./tipos";

/** Avisos (não bloqueios): abaixo destes valores a leitura do QR impresso fica arriscada. */
export const QR_PEQUENO_MM = 15;
export const MODULO_PEQUENO_MM = 0.4;

export interface QuadradoDoQr {
  /** Canto inferior esquerdo do quadrado (fundo branco, zona de silêncio incluída), em pontos. */
  x: number;
  y: number;
  /** Lado do quadrado, com a zona de silêncio. */
  lado: number;
  /** Lado de um módulo. */
  modulo: number;
  /** Lado só da parte com módulos (sem a zona de silêncio). */
  ladoDoSimbolo: number;
}

/**
 * O QR é o MAIOR QUADRADO que cabe na área, centralizado nela. A zona de silêncio fica DENTRO do
 * quadrado, então os módulos nunca encostam em bordas decorativas ao redor do espaço reservado.
 */
export function quadradoDoQr(config: ConfiguracaoDoQr, modulosPorLado: number): QuadradoDoQr {
  const { area, zonaDeSilencioModulos } = config;
  const lado = Math.min(area.largura, area.altura);
  const modulo = lado / (modulosPorLado + 2 * zonaDeSilencioModulos);
  return {
    x: area.x + (area.largura - lado) / 2,
    y: area.y + (area.altura - lado) / 2,
    lado,
    modulo,
    ladoDoSimbolo: modulo * modulosPorLado,
  };
}

export interface MedidasDoQr {
  /** Lado do QR impresso (só os módulos), em mm. */
  ladoMm: number;
  /** Lado do quadrado branco, com a zona de silêncio, em mm. */
  ladoComMargemMm: number;
  moduloMm: number;
  avisos: string[];
}

export function medidasDoQr(config: ConfiguracaoDoQr, modulosPorLado: number): MedidasDoQr {
  const quadrado = quadradoDoQr(config, modulosPorLado);
  const ladoMm = ptToMm(quadrado.ladoDoSimbolo);
  const moduloMm = ptToMm(quadrado.modulo);
  const avisos: string[] = [];
  if (ladoMm < QR_PEQUENO_MM) {
    avisos.push(`O QR Code ficará com menos de ${QR_PEQUENO_MM} mm: a leitura pode falhar em alguns celulares.`);
  }
  if (moduloMm < MODULO_PEQUENO_MM) {
    avisos.push(
      `Cada módulo do QR Code ficará com menos de ${String(MODULO_PEQUENO_MM).replace(".", ",")} mm: a impressão pode não reproduzir os detalhes.`,
    );
  }
  return { ladoMm, ladoComMargemMm: ptToMm(quadrado.lado), moduloMm, avisos };
}
