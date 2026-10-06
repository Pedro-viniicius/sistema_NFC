// Modelos de impressão: configuração central da arte de cada produto.
// A ARTE FIXA fica no PDF do modelo (pasta templates/); aqui ficam só as medidas e a posição
// dos DADOS VARIÁVEIS (QR Code e código do cartão). Nenhuma rota conhece coordenadas.
import type { TipoDestino } from "@/modules/cards/tipos";
import { ZONA_DE_SILENCIO_EM_MODULOS, type MatrizDoQr } from "@/modules/qr/gerar";
import { mmParaPontos } from "./unidades";

/** Distância mínima entre o conteúdo importante e a linha de corte. */
export const MARGEM_DE_SEGURANCA_MM = 3;
/** Menor módulo de QR aceito: abaixo disso a leitura em impressão fica arriscada. */
export const MODULO_MINIMO_MM = 0.5;

export interface PosicaoDoCodigo {
  /** Centro horizontal do texto, em mm a partir da borda esquerda do corte. */
  xCentroMm: number;
  /** Linha de base do texto, em mm a partir da borda superior do corte. */
  linhaDeBaseMm: number;
  tamanhoPt: number;
  cor: "preto" | "branco";
}

export interface ModeloDeImpressao {
  tipo: TipoDestino;
  /** Usado nos nomes de arquivo (ex.: google-K8M4T2.pdf). */
  slug: string;
  nome: string;
  /** PDF de uma página com a arte fixa, dentro de templates/. */
  arquivo: string;
  /** Tamanho final do adesivo, depois do corte. */
  larguraFinalMm: number;
  alturaFinalMm: number;
  /** Sangria em cada lado. A arte completa mede (largura + 2×sangria) × (altura + 2×sangria). */
  sangriaMm: number;
  /**
   * Área quadrada reservada ao QR, JÁ INCLUINDO a zona de silêncio (4 módulos de cada lado).
   * x e y são medidos a partir do canto superior esquerdo do corte.
   */
  qr: { xMm: number; yMm: number; tamanhoMm: number };
  /**
   * Posição do código do cartão na arte. O código impresso é o que liga o adesivo ao chip NFC
   * e ao cadastro; use `null` apenas se o produto não puder exibi-lo (ele continua no controle.csv).
   */
  codigo: PosicaoDoCodigo | null;
}

// Os dois modelos compartilham o formato físico: 86 × 54 mm com 3 mm de sangria (arte de 92 × 60 mm).
const FORMATO_DO_ADESIVO = { larguraFinalMm: 86, alturaFinalMm: 54, sangriaMm: 3 } as const;
const QR_PADRAO = { xMm: 50, yMm: 6, tamanhoMm: 30 } as const;

const MODELOS = {
  GOOGLE: {
    tipo: "GOOGLE",
    slug: "google",
    nome: "Google",
    arquivo: "google.pdf",
    ...FORMATO_DO_ADESIVO,
    qr: QR_PADRAO,
    codigo: { xCentroMm: 65, linhaDeBaseMm: 40.2, tamanhoPt: 6.5, cor: "preto" },
  },
  INSTAGRAM: {
    tipo: "INSTAGRAM",
    slug: "instagram",
    nome: "Instagram",
    arquivo: "instagram.pdf",
    ...FORMATO_DO_ADESIVO,
    qr: QR_PADRAO,
    codigo: { xCentroMm: 65, linhaDeBaseMm: 40.2, tamanhoPt: 6.5, cor: "branco" },
  },
} as const satisfies Partial<Record<TipoDestino, ModeloDeImpressao>>;

export function listarModelos(): ModeloDeImpressao[] {
  return Object.values(MODELOS);
}

/** Modelo do tipo informado, ou null se o tipo não tiver arte de impressão (ex.: "Outro link"). */
export function obterModelo(tipo: TipoDestino | null | undefined): ModeloDeImpressao | null {
  return tipo && tipo in MODELOS ? MODELOS[tipo as keyof typeof MODELOS] : null;
}

export function obterModeloPorSlug(slug: unknown): ModeloDeImpressao | null {
  return listarModelos().find((modelo) => modelo.slug === slug) ?? null;
}

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface GeometriaDoModelo {
  /** Arte completa (com sangria), em pontos. */
  larguraPt: number;
  alturaPt: number;
  /** Linha de corte, em pontos, com origem no canto inferior esquerdo da arte (convenção do PDF). */
  corte: Retangulo;
  /** Área do QR (com zona de silêncio), em pontos, na mesma convenção. */
  qr: Retangulo;
}

/** Converte as medidas do modelo (mm, a partir do canto superior esquerdo do corte) para o PDF. */
export function geometriaDoModelo(modelo: ModeloDeImpressao): GeometriaDoModelo {
  const sangria = mmParaPontos(modelo.sangriaMm);
  const larguraFinal = mmParaPontos(modelo.larguraFinalMm);
  const alturaFinal = mmParaPontos(modelo.alturaFinalMm);
  const ladoDoQr = mmParaPontos(modelo.qr.tamanhoMm);
  return {
    larguraPt: larguraFinal + 2 * sangria,
    alturaPt: alturaFinal + 2 * sangria,
    corte: { x: sangria, y: sangria, largura: larguraFinal, altura: alturaFinal },
    qr: {
      x: sangria + mmParaPontos(modelo.qr.xMm),
      // No PDF o eixo y cresce para cima: o canto inferior do QR fica a (altura − y − tamanho) da base do corte.
      y: sangria + mmParaPontos(modelo.alturaFinalMm - modelo.qr.yMm - modelo.qr.tamanhoMm),
      largura: ladoDoQr,
      altura: ladoDoQr,
    },
  };
}

/** Confere as medidas do modelo. Devolve a lista de problemas (vazia = modelo válido). */
export function validarModelo(modelo: ModeloDeImpressao): string[] {
  const problemas: string[] = [];
  const { larguraFinalMm, alturaFinalMm, sangriaMm, qr, codigo } = modelo;
  const medidas = [larguraFinalMm, alturaFinalMm, sangriaMm, qr.xMm, qr.yMm, qr.tamanhoMm];

  if (!medidas.every(Number.isFinite) || larguraFinalMm <= 0 || alturaFinalMm <= 0 || sangriaMm < 0) {
    problemas.push(`As dimensões do modelo ${modelo.nome} são inválidas.`);
    return problemas;
  }
  if (qr.tamanhoMm <= 0) {
    problemas.push(`O tamanho do QR Code do modelo ${modelo.nome} é inválido.`);
    return problemas;
  }

  const margem = MARGEM_DE_SEGURANCA_MM;
  const cabeNaLargura = qr.xMm >= margem && qr.xMm + qr.tamanhoMm <= larguraFinalMm - margem;
  const cabeNaAltura = qr.yMm >= margem && qr.yMm + qr.tamanhoMm <= alturaFinalMm - margem;
  if (!cabeNaLargura || !cabeNaAltura) {
    problemas.push(
      `A área do QR Code do modelo ${modelo.nome} não cabe na arte com ${margem} mm de margem de segurança.`,
    );
  }
  if (codigo) {
    const dentro =
      codigo.xCentroMm > margem &&
      codigo.xCentroMm < larguraFinalMm - margem &&
      codigo.linhaDeBaseMm > margem &&
      codigo.linhaDeBaseMm < alturaFinalMm - margem;
    if (!dentro || codigo.tamanhoPt <= 0) {
      problemas.push(`A posição do código do cartão no modelo ${modelo.nome} está fora da área segura.`);
    }
  }
  return problemas;
}

/** Tamanho de cada módulo do QR quando desenhado na área do modelo, em mm. */
export function tamanhoDoModuloMm(modelo: ModeloDeImpressao, matriz: MatrizDoQr): number {
  return modelo.qr.tamanhoMm / (matriz.lado + 2 * ZONA_DE_SILENCIO_EM_MODULOS);
}
