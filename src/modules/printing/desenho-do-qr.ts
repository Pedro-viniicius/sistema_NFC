// Desenha o QR Code no PDF como geometria vetorial: nítido em qualquer resolução de impressão.
import {
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingCmykColor,
  type PDFPage,
} from "pdf-lib";
import { ZONA_DE_SILENCIO_EM_MODULOS, agruparEmFaixas, type MatrizDoQr } from "@/modules/qr/gerar";
import type { Retangulo } from "./modelos";

/** Marca o trecho do QR no conteúdo da página, o que permite localizá-lo e conferi-lo depois. */
export const MARCA_DO_QR = "QRCode";

/**
 * `area` é o quadrado completo do QR, incluindo a zona de silêncio.
 * - Fundo: branco (sem tinta), cobrindo a zona de silêncio, para o contraste não depender da arte.
 * - Módulos: preto puro (só o canal K), sem mistura de cores, para não haver problema de registro.
 * - Todos os módulos entram em um único preenchimento: sem emendas, sem arredondamento, sem rotação.
 */
export function desenharQr(pagina: PDFPage, matriz: MatrizDoQr, area: Retangulo): void {
  const modulo = area.largura / (matriz.lado + 2 * ZONA_DE_SILENCIO_EM_MODULOS);
  const esquerda = area.x + ZONA_DE_SILENCIO_EM_MODULOS * modulo;
  const topo = area.y + area.altura - ZONA_DE_SILENCIO_EM_MODULOS * modulo;

  pagina.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of(MARCA_DO_QR)]),
    pushGraphicsState(),
    setFillingCmykColor(0, 0, 0, 0),
    rectangle(area.x, area.y, area.largura, area.altura),
    fill(),
    setFillingCmykColor(0, 0, 0, 1),
    ...agruparEmFaixas(matriz).map((faixa) =>
      rectangle(
        esquerda + faixa.coluna * modulo,
        topo - (faixa.linha + 1) * modulo,
        faixa.largura * modulo,
        modulo,
      ),
    ),
    fill(),
    popGraphicsState(),
    PDFOperator.of(PDFOperatorNames.EndMarkedContent),
  );
}
