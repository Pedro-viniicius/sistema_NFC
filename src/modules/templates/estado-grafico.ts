// Analisa o conteúdo de uma página de PDF para saber se a arte deixa estados gráficos abertos.
//
// O QR é desenhado DEPOIS da arte. Se a arte termina com um `q` sem `Q` (ou com uma matriz de
// transformação alterada, um recorte ativo…), o QR sairia deslocado, ampliado ou cortado. Para
// isolar a arte, o gerador a envolve em `q … Q` e precisa saber quantos níveis ela abre e fecha.
//
// A leitura é apenas léxica: conta os operadores `q` e `Q`, pulando textos, nomes, comentários e
// os dados binários de imagens embutidas (BI … ID … EI), onde essas letras podem aparecer.

const BRANCOS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITADORES = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const fimDeToken = (byte: number) => BRANCOS.has(byte) || DELIMITADORES.has(byte);

/** Posição logo depois do `EI` que encerra os dados de uma imagem embutida. */
function depoisDaImagemEmbutida(dados: Uint8Array, inicio: number): number {
  for (let i = inicio + 1; i + 1 < dados.length; i++) {
    const encerra =
      dados[i] === 0x45 &&
      dados[i + 1] === 0x49 &&
      BRANCOS.has(dados[i - 1]) &&
      (i + 2 >= dados.length || fimDeToken(dados[i + 2]));
    if (encerra) return i + 2;
  }
  return dados.length;
}

export interface EstadoGrafico {
  /** Menor nível atingido (negativo quando a arte fecha estados que não abriu). */
  minimo: number;
  /** Nível ao final do conteúdo (positivo quando a arte deixa estados abertos). */
  final: number;
}

export function analisarEstadoGrafico(dados: Uint8Array): EstadoGrafico {
  const n = dados.length;
  let nivel = 0;
  let minimo = 0;
  let i = 0;

  while (i < n) {
    const byte = dados[i];
    if (BRANCOS.has(byte)) {
      i++;
    } else if (byte === 0x25) {
      // % comentário até o fim da linha
      while (i < n && dados[i] !== 0x0a && dados[i] !== 0x0d) i++;
    } else if (byte === 0x28) {
      // (texto), com parênteses aninhados e escapes
      let aninhamento = 1;
      i++;
      while (i < n && aninhamento > 0) {
        if (dados[i] === 0x5c) i++;
        else if (dados[i] === 0x28) aninhamento++;
        else if (dados[i] === 0x29) aninhamento--;
        i++;
      }
    } else if (byte === 0x3c && dados[i + 1] !== 0x3c) {
      // <texto em hexadecimal>
      while (i < n && dados[i] !== 0x3e) i++;
      i++;
    } else if (byte === 0x2f) {
      // /Nome
      i++;
      while (i < n && !fimDeToken(dados[i])) i++;
    } else if (DELIMITADORES.has(byte)) {
      i++;
    } else {
      const inicio = i;
      while (i < n && !fimDeToken(dados[i])) i++;
      const tamanho = i - inicio;
      if (tamanho === 1 && dados[inicio] === 0x71) {
        nivel++;
      } else if (tamanho === 1 && dados[inicio] === 0x51) {
        nivel--;
        minimo = Math.min(minimo, nivel);
      } else if (tamanho === 2 && dados[inicio] === 0x49 && dados[inicio + 1] === 0x44) {
        i = depoisDaImagemEmbutida(dados, i);
      }
    }
  }
  return { minimo, final: nivel };
}
