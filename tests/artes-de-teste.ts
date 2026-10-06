// PDFs de arte criados em memória para os testes de envio de arte.
import { PDFDocument, cmyk, fill, rectangle, setFillingCmykColor } from "pdf-lib";
import { mmParaPontos } from "@/modules/printing/unidades";

interface OpcoesDaArte {
  larguraMm?: number;
  alturaMm?: number;
  paginas?: number;
  /** Quantidade de retângulos pseudoaleatórios, para simular uma arte pesada. */
  formas?: number;
  /** Cor de fundo distinta, para diferenciar uma arte da outra. */
  ciano?: number;
}

/** Arte de uma página (por padrão 92 × 60 mm, com sangria) com um fundo colorido. */
export async function criarArteDeTeste(opcoes: OpcoesDaArte = {}): Promise<Uint8Array> {
  const largura = mmParaPontos(opcoes.larguraMm ?? 92);
  const altura = mmParaPontos(opcoes.alturaMm ?? 60);
  const documento = await PDFDocument.create();

  for (let numero = 0; numero < (opcoes.paginas ?? 1); numero++) {
    const pagina = documento.addPage([largura, altura]);
    pagina.drawRectangle({ x: 0, y: 0, width: largura, height: altura, color: cmyk(opcoes.ciano ?? 0.4, 0.1, 0, 0) });

    // Gerador determinístico: a mesma chamada produz sempre o mesmo arquivo.
    let semente = 12345;
    const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
    const formas = Array.from({ length: opcoes.formas ?? 0 }, () => [
      setFillingCmykColor(aleatorio(), aleatorio(), aleatorio(), 0),
      rectangle(aleatorio() * largura, aleatorio() * altura, aleatorio() * 9, aleatorio() * 9),
      fill(),
    ]).flat();
    if (formas.length > 0) pagina.pushOperators(...formas);
  }
  return documento.save();
}
