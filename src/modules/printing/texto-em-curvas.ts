// Texto desenhado como contornos vetoriais ("texto em curvas"), sem fonte embutida no PDF.
// É a prática usual de pré-impressão: o arquivo não depende de a gráfica ter a fonte.
import type { Color, PDFPage } from "pdf-lib";

export interface Glifo {
  /** Contorno em sintaxe de caminho SVG, em unidades da fonte, com y para baixo e linha de base em 0. */
  caminho: string;
  avanco: number;
}

export interface TabelaDeGlifos {
  fonte: string;
  unidadesPorEm: number;
  glifos: Record<string, Glifo>;
}

export interface OpcoesDeTexto {
  /** Posição em pontos do PDF. `y` é a linha de base. */
  x: number;
  y: number;
  tamanhoPt: number;
  cor: Color;
  alinhamento?: "esquerda" | "centro";
  /** Espaço extra entre letras, em pontos. */
  espacamentoPt?: number;
}

function glifoDe(tabela: TabelaDeGlifos, caractere: string): Glifo {
  const glifo = tabela.glifos[caractere];
  if (!glifo) {
    throw new Error(`O caractere "${caractere}" não existe na tabela de glifos (${tabela.fonte}).`);
  }
  return glifo;
}

export function larguraDoTexto(
  texto: string,
  tabela: TabelaDeGlifos,
  tamanhoPt: number,
  espacamentoPt = 0,
): number {
  const caracteres = [...texto];
  const escala = tamanhoPt / tabela.unidadesPorEm;
  const avancos = caracteres.reduce((soma, caractere) => soma + glifoDe(tabela, caractere).avanco, 0);
  return avancos * escala + Math.max(caracteres.length - 1, 0) * espacamentoPt;
}

export function desenharTextoEmCurvas(
  pagina: PDFPage,
  texto: string,
  tabela: TabelaDeGlifos,
  opcoes: OpcoesDeTexto,
): void {
  const espacamento = opcoes.espacamentoPt ?? 0;
  const escala = opcoes.tamanhoPt / tabela.unidadesPorEm;
  const largura = larguraDoTexto(texto, tabela, opcoes.tamanhoPt, espacamento);
  let x = opcoes.alinhamento === "centro" ? opcoes.x - largura / 2 : opcoes.x;

  for (const caractere of texto) {
    const glifo = glifoDe(tabela, caractere);
    if (glifo.caminho) {
      pagina.drawSvgPath(glifo.caminho, { x, y: opcoes.y, scale: escala, color: opcoes.cor, borderWidth: 0 });
    }
    x += glifo.avanco * escala + espacamento;
  }
}
