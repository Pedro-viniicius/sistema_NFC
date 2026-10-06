// PDFs de template escritos "à mão", objeto por objeto, para os testes e para as fixtures.
// Não usa nenhuma biblioteca de PDF: assim o arquivo tem exatamente a estrutura que o teste precisa
// (origem da MediaBox, CropBox, rotação, estado gráfico deixado aberto, ações, anexos…).
import { deflateSync } from "node:zlib";
import { mmParaPontos } from "@/modules/printing/unidades";
import type { CaixaPt, RetanguloPt } from "@/modules/templates/tipos";

type ObjetoBruto = string | { dicionario: string; dados: Uint8Array };

const latin1 = (texto: string) => Buffer.from(texto, "latin1");

/** Monta um PDF 1.7 com tabela xref clássica. O objeto 1 é o catálogo. */
export function montarPdfBruto(objetos: ObjetoBruto[], extraDoTrailer = ""): Uint8Array {
  const partes: Buffer[] = [latin1("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")];
  const posicoes: number[] = [];
  let tamanho = partes[0].length;
  const acrescentar = (parte: Buffer) => {
    partes.push(parte);
    tamanho += parte.length;
  };

  objetos.forEach((objeto, indice) => {
    posicoes.push(tamanho);
    acrescentar(latin1(`${indice + 1} 0 obj\n`));
    if (typeof objeto === "string") {
      acrescentar(latin1(`${objeto}\n`));
    } else {
      acrescentar(latin1(`<< ${objeto.dicionario} /Length ${objeto.dados.length} >>\nstream\n`));
      acrescentar(Buffer.from(objeto.dados));
      acrescentar(latin1("\nendstream\n"));
    }
    acrescentar(latin1("endobj\n"));
  });

  const inicioDaXref = tamanho;
  const linhas = posicoes.map((posicao) => `${String(posicao).padStart(10, "0")} 00000 n \n`).join("");
  acrescentar(
    latin1(
      `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${linhas}` +
        `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R ${extraDoTrailer}>>\nstartxref\n${inicioDaXref}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(partes));
}

function comprimido(dicionario: string, conteudo: string | Uint8Array): ObjetoBruto {
  const dados = deflateSync(typeof conteudo === "string" ? latin1(conteudo) : Buffer.from(conteudo));
  return { dicionario: `${dicionario} /Filter /FlateDecode`, dados: new Uint8Array(dados) };
}

/** Imagem RGB de 48 × 48 px com um degradê: faz o papel do logotipo embutido na arte. */
function imagemDeTeste(): ObjetoBruto {
  const lado = 48;
  const pixels = new Uint8Array(lado * lado * 3);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const i = (y * lado + x) * 3;
      pixels[i] = Math.round((x / (lado - 1)) * 255);
      pixels[i + 1] = Math.round((y / (lado - 1)) * 255);
      pixels[i + 2] = 180;
    }
  }
  return comprimido(
    `/Type /XObject /Subtype /Image /Width ${lado} /Height ${lado} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
    pixels,
  );
}

const n = (valor: number) => String(Math.round(valor * 1000) / 1000);

export type TemaDoTemplate = "google" | "instagram";

const TEMAS: Record<TemaDoTemplate, { esquerda: string; direita: string; titulo: string; chamada: string }> = {
  google: { esquerda: "0.10 0.45 0.91", direita: "0.96 0.97 0.99", titulo: "Google", chamada: "AVALIE NO GOOGLE" },
  instagram: { esquerda: "0.76 0.21 0.52", direita: "0.99 0.95 0.92", titulo: "Instagram", chamada: "SIGA NO INSTAGRAM" },
};

/** Tamanho das artes de exemplo: dois painéis lado a lado em uma única página. */
export const LARGURA_DO_TEMPLATE_MM = 130.05;
export const ALTURA_DO_TEMPLATE_MM = 86.7;
/** Espaço reservado (em branco) para o QR, em mm a partir do canto superior esquerdo da arte. */
export const ESPACO_DO_QR_MM = { xMm: 80.5, yMm: 22, larguraMm: 34, alturaMm: 34 } as const;

export interface OpcoesDoTemplate {
  tema?: TemaDoTemplate;
  larguraMm?: number;
  alturaMm?: number;
  /** Origem da MediaBox, em pontos. Padrão: (0, 0). */
  origem?: [x: number, y: number];
  /** Margem, em pontos, entre a MediaBox e a arte: a CropBox passa a ser só a arte. */
  margemDaCropBox?: number;
  rotacao?: number;
  paginas?: number;
  /** Termina a arte com um `q` sem `Q` e uma matriz de transformação alterada. */
  estadoGraficoAberto?: boolean;
  /** Começa a arte com um `Q` a mais (fecha um estado gráfico que ela não abriu). */
  restauracaoAMais?: boolean;
  /** Ação de JavaScript ao abrir o documento. */
  javascript?: boolean;
  /** Ação que abre um programa externo. */
  launch?: boolean;
  /** Arquivo anexado ao PDF. */
  anexo?: boolean;
  trimBoxMm?: number;
  /** Dados extras sem uso (bytes), para simular uma arte pesada. */
  pesoExtraBytes?: number;
}

export interface TemplateDeTeste {
  bytes: Uint8Array;
  mediaBox: CaixaPt;
  /** Página visível (CropBox limitada à MediaBox). */
  visao: CaixaPt;
  /** Espaço reservado para o QR, em pontos, no espaço do usuário da página. */
  areaDoQr: RetanguloPt;
}

/**
 * Arte de cartão em dois painéis (lado NFC e lado QR) com conteúdo vetorial, texto, uma imagem
 * embutida e um espaço em branco para o QR Code.
 */
export function criarPdfDeTemplate(opcoes: OpcoesDoTemplate = {}): TemplateDeTeste {
  const tema = TEMAS[opcoes.tema ?? "google"];
  const largura = mmParaPontos(opcoes.larguraMm ?? LARGURA_DO_TEMPLATE_MM);
  const altura = mmParaPontos(opcoes.alturaMm ?? ALTURA_DO_TEMPLATE_MM);
  const [ox, oy] = opcoes.origem ?? [0, 0];
  const margem = opcoes.margemDaCropBox ?? 0;

  // A arte ocupa a página visível; com margem, a MediaBox é maior que a arte.
  const visao: CaixaPt = [ox + margem, oy + margem, ox + margem + largura, oy + margem + altura];
  const mediaBox: CaixaPt = [ox, oy, ox + largura + 2 * margem, oy + altura + 2 * margem];

  const qr = {
    x: visao[0] + mmParaPontos(ESPACO_DO_QR_MM.xMm),
    y: visao[3] - mmParaPontos(ESPACO_DO_QR_MM.yMm + ESPACO_DO_QR_MM.alturaMm),
    largura: mmParaPontos(ESPACO_DO_QR_MM.larguraMm),
    altura: mmParaPontos(ESPACO_DO_QR_MM.alturaMm),
  };
  const meio = largura / 2;
  const k = 0.5523; // aproximação de círculo por curvas de Bézier
  const raio = 30;
  const cx = meio / 2;
  const cy = altura * 0.52;

  const arte = [
    opcoes.restauracaoAMais ? "Q" : "",
    "q",
    `1 0 0 1 ${n(visao[0])} ${n(visao[1])} cm`,
    // Painel do NFC (esquerda) e painel do QR (direita).
    `${tema.esquerda} rg 0 0 ${n(meio)} ${n(altura)} re f`,
    `${tema.direita} rg ${n(meio)} 0 ${n(meio)} ${n(altura)} re f`,
    // Ícone circular do NFC, em curvas.
    "1 1 1 rg",
    `${n(cx + raio)} ${n(cy)} m`,
    `${n(cx + raio)} ${n(cy + raio * k)} ${n(cx + raio * k)} ${n(cy + raio)} ${n(cx)} ${n(cy + raio)} c`,
    `${n(cx - raio * k)} ${n(cy + raio)} ${n(cx - raio)} ${n(cy + raio * k)} ${n(cx - raio)} ${n(cy)} c`,
    `${n(cx - raio)} ${n(cy - raio * k)} ${n(cx - raio * k)} ${n(cy - raio)} ${n(cx)} ${n(cy - raio)} c`,
    `${n(cx + raio * k)} ${n(cy - raio)} ${n(cx + raio)} ${n(cy - raio * k)} ${n(cx + raio)} ${n(cy)} c f`,
    // Logotipo (imagem embutida).
    `q 36 0 0 36 ${n(cx - 18)} ${n(cy - 18)} cm /Im1 Do Q`,
    // Textos.
    `BT /F1 15 Tf 1 1 1 rg ${n(cx - 30)} ${n(altura - 40)} Td (${tema.titulo}) Tj ET`,
    `BT /F1 9 Tf 1 1 1 rg ${n(cx - 52)} 34 Td (APROXIME SEU CELULAR) Tj ET`,
    `BT /F1 10 Tf 0.15 0.15 0.2 rg ${n(meio + 40)} ${n(altura - 40)} Td (${tema.chamada}) Tj ET`,
    `BT /F1 9 Tf 0.15 0.15 0.2 rg ${n(meio + 66)} 34 Td (OU ESCANEIE) Tj ET`,
    // Espaço reservado para o QR: quadrado branco com um contorno decorativo.
    `1 1 1 rg ${n(qr.x - visao[0])} ${n(qr.y - visao[1])} ${n(qr.largura)} ${n(qr.altura)} re f`,
    `0.6 0.6 0.65 RG 0.8 w ${n(qr.x - visao[0] - 3)} ${n(qr.y - visao[1] - 3)} ${n(qr.largura + 6)} ${n(qr.altura + 6)} re S`,
    opcoes.estadoGraficoAberto
      ? // A arte "esquece" um estado gráfico aberto e deixa a página ampliada, deslocada e recortada.
        "q 1.7 0 0 1.3 45 -30 cm 0 0 20 20 re W n"
      : "Q",
  ]
    .filter((linha) => linha.length > 0)
    .join("\n");

  const caixas = [
    `/MediaBox [${mediaBox.map(n).join(" ")}]`,
    margem > 0 ? `/CropBox [${visao.map(n).join(" ")}]` : "",
    opcoes.trimBoxMm !== undefined
      ? `/TrimBox [${[
          visao[0] + mmParaPontos(opcoes.trimBoxMm),
          visao[1] + mmParaPontos(opcoes.trimBoxMm),
          visao[2] - mmParaPontos(opcoes.trimBoxMm),
          visao[3] - mmParaPontos(opcoes.trimBoxMm),
        ]
          .map(n)
          .join(" ")}] /BleedBox [${visao.map(n).join(" ")}]`
      : "",
    opcoes.rotacao ? `/Rotate ${opcoes.rotacao}` : "",
  ]
    .filter((linha) => linha.length > 0)
    .join(" ");

  const paginas = opcoes.paginas ?? 1;
  // Numeração: 1 catálogo, 2 árvore de páginas, 3 conteúdo, 4 imagem, 5 fonte, 6.. páginas, depois extras.
  const primeiraPagina = 6;
  const kids = Array.from({ length: paginas }, (_, i) => `${primeiraPagina + i} 0 R`).join(" ");
  let proximo = primeiraPagina + paginas;
  const extras: ObjetoBruto[] = [];
  let noCatalogo = "";

  if (opcoes.javascript) {
    extras.push("<< /Type /Action /S /JavaScript /JS (app.alert\\('oi'\\);) >>");
    noCatalogo += ` /OpenAction ${proximo++} 0 R`;
  }
  if (opcoes.launch) {
    extras.push("<< /Type /Action /S /Launch /F (calc.exe) >>");
    noCatalogo += ` /OpenAction ${proximo++} 0 R`;
  }
  if (opcoes.anexo) {
    extras.push({ dicionario: "/Type /EmbeddedFile", dados: new Uint8Array(latin1("conteudo do anexo")) });
    const arquivo = proximo++;
    extras.push(`<< /Type /Filespec /F (anexo.txt) /EF << /F ${arquivo} 0 R >> >>`);
    const especificacao = proximo++;
    noCatalogo += ` /Names << /EmbeddedFiles << /Names [(anexo.txt) ${especificacao} 0 R] >> >>`;
  }
  if (opcoes.pesoExtraBytes) {
    // Bytes pseudoaleatórios (não comprimíveis), ligados aos recursos da página como um objeto qualquer.
    const peso = new Uint8Array(opcoes.pesoExtraBytes);
    let semente = 987654321;
    for (let i = 0; i < peso.length; i++) {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      peso[i] = semente & 0xff;
    }
    extras.push({ dicionario: "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", dados: peso });
    proximo++;
  }
  const pesoRef = opcoes.pesoExtraBytes ? ` /Peso ${proximo - 1} 0 R` : "";

  const pagina =
    `<< /Type /Page /Parent 2 0 R ${caixas} ` +
    `/Resources << /XObject << /Im1 4 0 R${pesoRef} >> /Font << /F1 5 0 R >> >> /Contents 3 0 R >>`;

  const bytes = montarPdfBruto([
    `<< /Type /Catalog /Pages 2 0 R${noCatalogo} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${paginas} >>`,
    comprimido("", arte),
    imagemDeTeste(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...Array.from({ length: paginas }, () => pagina),
    ...extras,
  ]);

  return { bytes, mediaBox, visao, areaDoQr: qr };
}
