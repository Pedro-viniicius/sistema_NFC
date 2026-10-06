// Gera os arquivos estáticos de impressão em templates/:
//   - google.pdf e instagram.pdf: ARTES-BASE (fundo, textos, estrelas, símbolo de aproximação);
//   - glifos-do-codigo.json: contornos das letras usadas para imprimir o código do cartão.
//
// Uso:  pnpm impressao:modelos
//
// Este script só roda em desenvolvimento. A aplicação não desenha a arte: ela apenas carrega o PDF
// do modelo e aplica por cima o QR Code e o código de cada cartão.
//
// Para usar a arte definitiva de um designer, substitua o PDF em templates/ por um PDF de UMA página
// com exatamente o tamanho da arte (92 × 60 mm: 86 × 54 mm + 3 mm de sangria) e, se a posição do QR
// mudar, ajuste as medidas em src/modules/printing/modelos.ts. Não rode este script depois disso,
// pois ele recria as artes-base.
//
// As artes-base não usam logotipos oficiais do Google nem do Instagram (marcas registradas):
// a identidade visual definitiva deve vir do designer, respeitando as regras de cada marca.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as fontkit from "fontkit";
import { LineCapStyle, PDFDocument, cmyk, type Color, type PDFPage } from "pdf-lib";
import { ALFABETO_CODIGO } from "../src/modules/cards/codigo";
import { geometriaDoModelo, obterModelo, type ModeloDeImpressao } from "../src/modules/printing/modelos";
import {
  desenharTextoEmCurvas,
  type Glifo,
  type TabelaDeGlifos,
} from "../src/modules/printing/texto-em-curvas";
import { mmParaPontos } from "../src/modules/printing/unidades";

const PASTA = join(process.cwd(), "templates");
const require = createRequire(import.meta.url);

// --- Fontes (Inter, licença SIL OFL) convertidas em contornos ---------------------------------

function abrirFonte(peso: 400 | 700): fontkit.Font {
  const arquivo = require.resolve(`@fontsource/inter/files/inter-latin-${peso}-normal.woff2`);
  return fontkit.create(readFileSync(arquivo)) as fontkit.Font;
}

function contornoDoGlifo(glifo: fontkit.Glyph): string {
  // A fonte usa y para cima; o caminho SVG usa y para baixo.
  return glifo.path.commands
    .map(({ command, args }) => {
      const pontos = args.map((valor, indice) => (indice % 2 === 1 ? -valor : valor)).join(" ");
      switch (command) {
        case "moveTo":
          return `M${pontos}`;
        case "lineTo":
          return `L${pontos}`;
        case "quadraticCurveTo":
          return `Q${pontos}`;
        case "bezierCurveTo":
          return `C${pontos}`;
        default:
          return "Z";
      }
    })
    .join("");
}

function tabelaDeGlifos(fonte: fontkit.Font, caracteres: string): TabelaDeGlifos {
  const glifos: Record<string, Glifo> = {};
  for (const caractere of [...new Set(caracteres)].sort()) {
    const [glifo] = fonte.layout(caractere).glyphs;
    if (!glifo || glifo.id === 0) throw new Error(`A fonte não tem o caractere "${caractere}".`);
    glifos[caractere] = { caminho: contornoDoGlifo(glifo), avanco: glifo.advanceWidth };
  }
  return { fonte: fonte.fullName, unidadesPorEm: fonte.unitsPerEm, glifos };
}

const CARACTERES_DAS_ARTES =
  " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-,.@áàâãçéêíóôõúÁÃÇÉÍÓÕÚ";
const regular = tabelaDeGlifos(abrirFonte(400), CARACTERES_DAS_ARTES);
const negrito = tabelaDeGlifos(abrirFonte(700), CARACTERES_DAS_ARTES);

// --- Utilitários de desenho, com medidas em mm a partir do canto superior esquerdo do CORTE ---

const BRANCO = cmyk(0, 0, 0, 0);

interface Prancha {
  pagina: PDFPage;
  modelo: ModeloDeImpressao;
  x: (mm: number) => number;
  y: (mm: number) => number;
}

function texto(
  prancha: Prancha,
  conteudo: string,
  tabela: TabelaDeGlifos,
  opcoes: { xMm: number; linhaDeBaseMm: number; tamanhoPt: number; cor: Color },
): void {
  desenharTextoEmCurvas(prancha.pagina, conteudo, tabela, {
    x: prancha.x(opcoes.xMm),
    y: prancha.y(opcoes.linhaDeBaseMm),
    tamanhoPt: opcoes.tamanhoPt,
    cor: opcoes.cor,
  });
}

/** Retângulo que pode avançar sobre a sangria (use medidas negativas ou além do corte). */
function retangulo(prancha: Prancha, xMm: number, yMm: number, larguraMm: number, alturaMm: number, cor: Color): void {
  prancha.pagina.drawRectangle({
    x: prancha.x(xMm),
    y: prancha.y(yMm + alturaMm),
    width: mmParaPontos(larguraMm),
    height: mmParaPontos(alturaMm),
    color: cor,
  });
}

function estrela(prancha: Prancha, xCentroMm: number, yCentroMm: number, raioMm: number, cor: Color): void {
  const pontos = Array.from({ length: 10 }, (_, indice) => {
    const raio = indice % 2 === 0 ? raioMm : raioMm * 0.42;
    const angulo = -Math.PI / 2 + (indice * Math.PI) / 5;
    return `${(raio * Math.cos(angulo)).toFixed(3)} ${(raio * Math.sin(angulo)).toFixed(3)}`;
  });
  prancha.pagina.drawSvgPath(`M${pontos.join("L")}Z`, {
    x: prancha.x(xCentroMm),
    y: prancha.y(yCentroMm),
    scale: mmParaPontos(1),
    color: cor,
    borderWidth: 0,
  });
}

/** Símbolo genérico de aproximação (ondas), não é o logotipo oficial de NFC. */
function simboloDeAproximacao(prancha: Prancha, xMm: number, yCentroMm: number, cor: Color): void {
  const opcoes = { x: prancha.x(xMm), y: prancha.y(yCentroMm), scale: mmParaPontos(1) };
  const seno = Math.SQRT1_2;
  for (const raio of [1.5, 2.7, 3.9]) {
    const ponta = (raio * seno).toFixed(3);
    prancha.pagina.drawSvgPath(`M${ponta} -${ponta}A${raio} ${raio} 0 0 1 ${ponta} ${ponta}`, {
      ...opcoes,
      borderColor: cor,
      borderWidth: 0.55,
      borderLineCap: LineCapStyle.Round,
    });
  }
  prancha.pagina.drawCircle({ x: opcoes.x, y: opcoes.y, size: mmParaPontos(0.6), color: cor });
}

async function criarArte(
  modelo: ModeloDeImpressao,
  titulo: string,
  desenhar: (prancha: Prancha) => void,
): Promise<Uint8Array> {
  const geometria = geometriaDoModelo(modelo);
  const documento = await PDFDocument.create();
  const pagina = documento.addPage([geometria.larguraPt, geometria.alturaPt]);
  const { corte } = geometria;
  pagina.setBleedBox(0, 0, geometria.larguraPt, geometria.alturaPt);
  pagina.setTrimBox(corte.x, corte.y, corte.largura, corte.altura);

  desenhar({
    pagina,
    modelo,
    x: (mm) => corte.x + mmParaPontos(mm),
    y: (mm) => corte.y + corte.altura - mmParaPontos(mm),
  });

  // Datas fixas: gerar de novo sem mudar a arte não altera o arquivo no Git.
  const data = new Date("2026-01-01T00:00:00Z");
  documento.setTitle(titulo);
  documento.setCreator("Sistema de Cartões NFC — gerar-modelos-de-impressao");
  documento.setProducer("pdf-lib");
  documento.setCreationDate(data);
  documento.setModificationDate(data);
  return documento.save();
}

/** Fundo que cobre toda a arte, incluindo a sangria. */
function fundo(prancha: Prancha, cor: Color): void {
  const { sangriaMm, larguraFinalMm, alturaFinalMm } = prancha.modelo;
  retangulo(prancha, -sangriaMm, -sangriaMm, larguraFinalMm + 2 * sangriaMm, alturaFinalMm + 2 * sangriaMm, cor);
}

/** Faixa inferior com a instrução de uso, até o fim da sangria. */
function faixaDeInstrucao(prancha: Prancha, corDaFaixa: Color): void {
  const { sangriaMm, larguraFinalMm, alturaFinalMm } = prancha.modelo;
  const topoMm = 44;
  retangulo(prancha, -sangriaMm, topoMm, larguraFinalMm + 2 * sangriaMm, alturaFinalMm - topoMm + sangriaMm, corDaFaixa);
  simboloDeAproximacao(prancha, 6.5, 49, BRANCO);
  texto(prancha, "Aproxime o celular ou aponte a câmera", regular, {
    xMm: 13.5,
    linhaDeBaseMm: 50,
    tamanhoPt: 7.5,
    cor: BRANCO,
  });
}

function arteDoGoogle(prancha: Prancha): void {
  const azul = cmyk(0.85, 0.5, 0, 0);
  const amarelo = cmyk(0, 0.22, 0.95, 0);
  fundo(prancha, BRANCO);
  texto(prancha, "Avalie-nos", negrito, { xMm: 6, linhaDeBaseMm: 16, tamanhoPt: 17, cor: cmyk(0, 0, 0, 0.9) });
  texto(prancha, "no Google", negrito, { xMm: 6, linhaDeBaseMm: 23.5, tamanhoPt: 17, cor: azul });
  for (let indice = 0; indice < 5; indice++) {
    estrela(prancha, 8.8 + indice * 6.3, 30.5, 2.8, amarelo);
  }
  texto(prancha, "Sua opinião faz a diferença", regular, {
    xMm: 6,
    linhaDeBaseMm: 39,
    tamanhoPt: 7,
    cor: cmyk(0, 0, 0, 0.65),
  });
  faixaDeInstrucao(prancha, azul);
}

function arteDoInstagram(prancha: Prancha): void {
  fundo(prancha, cmyk(0.3, 0.92, 0.05, 0));
  texto(prancha, "Siga-nos", negrito, { xMm: 6, linhaDeBaseMm: 16, tamanhoPt: 17, cor: BRANCO });
  texto(prancha, "no Instagram", negrito, { xMm: 6, linhaDeBaseMm: 23.5, tamanhoPt: 17, cor: cmyk(0, 0.2, 0.75, 0) });
  texto(prancha, "Fotos, novidades e promoções", regular, {
    xMm: 6,
    linhaDeBaseMm: 31,
    tamanhoPt: 7,
    cor: BRANCO,
  });
  faixaDeInstrucao(prancha, cmyk(0.55, 1, 0.2, 0.3));
}

function modeloDe(tipo: "GOOGLE" | "INSTAGRAM"): ModeloDeImpressao {
  const modelo = obterModelo(tipo);
  if (!modelo) throw new Error(`Modelo ${tipo} não configurado.`);
  return modelo;
}

async function principal(): Promise<void> {
  mkdirSync(PASTA, { recursive: true });

  const artes: Array<[ModeloDeImpressao, (prancha: Prancha) => void]> = [
    [modeloDe("GOOGLE"), arteDoGoogle],
    [modeloDe("INSTAGRAM"), arteDoInstagram],
  ];
  for (const [modelo, desenhar] of artes) {
    const pdf = await criarArte(modelo, `Arte-base — ${modelo.nome}`, desenhar);
    writeFileSync(join(PASTA, modelo.arquivo), pdf);
    console.log(`templates/${modelo.arquivo} (${pdf.length} bytes)`);
  }

  const glifosDoCodigo = tabelaDeGlifos(abrirFonte(700), ALFABETO_CODIGO);
  writeFileSync(join(PASTA, "glifos-do-codigo.json"), `${JSON.stringify(glifosDoCodigo)}\n`);
  console.log(`templates/glifos-do-codigo.json (${Object.keys(glifosDoCodigo.glifos).length} glifos)`);
}

principal().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
