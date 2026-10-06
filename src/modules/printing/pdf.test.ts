import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ErroDeDominio } from "@/lib/erros";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { lerArteDoModelo, lerPdfDeImpressao } from "../../../tests/ler-pdf";
import {
  geometriaDoModelo,
  listarModelos,
  obterModelo,
  obterModeloPorSlug,
  validarModelo,
  type ModeloDeImpressao,
} from "./modelos";
import { gerarPdfDeImpressao, gerarPdfDoCartao } from "./pdf";
import { mmParaPontos, pontosParaMm } from "./unidades";

function modelo(tipo: "GOOGLE" | "INSTAGRAM"): ModeloDeImpressao {
  const encontrado = obterModelo(tipo);
  if (!encontrado) throw new Error(`modelo ${tipo} ausente`);
  return encontrado;
}

const google = modelo("GOOGLE");
const instagram = modelo("INSTAGRAM");

describe("conversão de milímetros para pontos do PDF", () => {
  it("usa 72 pontos por polegada e 25,4 mm por polegada", () => {
    expect(mmParaPontos(25.4)).toBe(72);
    expect(mmParaPontos(0)).toBe(0);
    expect(mmParaPontos(86)).toBeCloseTo(243.7795, 4);
    expect(mmParaPontos(54)).toBeCloseTo(153.0709, 4);
    expect(mmParaPontos(3)).toBeCloseTo(8.5039, 4);
    expect(mmParaPontos(92)).toBeCloseTo(260.7874, 4);
  });

  it("a conversão inversa devolve a medida original", () => {
    expect(pontosParaMm(72)).toBeCloseTo(25.4, 10);
    for (const mm of [0.5, 3, 30, 54, 86]) expect(pontosParaMm(mmParaPontos(mm))).toBeCloseTo(mm, 10);
  });
});

describe("modelos de impressão", () => {
  it("há um modelo para Google e um para Instagram, e nenhum para outros tipos", () => {
    expect(listarModelos().map((m) => m.slug)).toEqual(["google", "instagram"]);
    expect(google.arquivo).toBe("google.pdf");
    expect(instagram.arquivo).toBe("instagram.pdf");
    expect(obterModelo("GENERICO")).toBeNull();
    expect(obterModelo(null)).toBeNull();
    expect(obterModeloPorSlug("instagram")).toBe(instagram);
    expect(obterModeloPorSlug("../google")).toBeNull();
  });

  it("o adesivo mede 86 × 54 mm com 3 mm de sangria (arte de 92 × 60 mm)", () => {
    for (const m of listarModelos()) {
      expect([m.larguraFinalMm, m.alturaFinalMm, m.sangriaMm]).toEqual([86, 54, 3]);
      const geometria = geometriaDoModelo(m);
      expect(pontosParaMm(geometria.larguraPt)).toBeCloseTo(92, 6);
      expect(pontosParaMm(geometria.alturaPt)).toBeCloseTo(60, 6);
      expect(validarModelo(m)).toEqual([]);
    }
  });

  it("converte a posição do QR para o sistema de coordenadas do PDF (origem embaixo, à esquerda)", () => {
    const { qr, corte } = geometriaDoModelo(google);
    expect(pontosParaMm(corte.x)).toBeCloseTo(3, 6);
    expect(pontosParaMm(qr.x)).toBeCloseTo(3 + google.qr.xMm, 6);
    expect(pontosParaMm(qr.y)).toBeCloseTo(3 + 54 - google.qr.yMm - google.qr.tamanhoMm, 6);
    expect(pontosParaMm(qr.largura)).toBeCloseTo(google.qr.tamanhoMm, 6);
  });

  it("aponta QR fora da área segura e dimensões inválidas", () => {
    expect(validarModelo({ ...google, qr: { xMm: 70, yMm: 6, tamanhoMm: 30 } })[0]).toContain("não cabe");
    expect(validarModelo({ ...google, qr: { xMm: 50, yMm: 30, tamanhoMm: 30 } })[0]).toContain("não cabe");
    expect(validarModelo({ ...google, larguraFinalMm: 0 })[0]).toContain("dimensões");
    expect(validarModelo({ ...google, qr: { xMm: 50, yMm: 6, tamanhoMm: Number.NaN } })[0]).toContain("dimensões");
  });

  it("os arquivos de arte têm uma página no tamanho exato do modelo e nenhuma fonte embutida", async () => {
    for (const m of listarModelos()) {
      const arte = await readFile(`templates/${m.arquivo}`);
      expect(arte.subarray(0, 5).toString()).toBe("%PDF-");
      expect(arte.toString("latin1")).not.toContain("/FontFile");
    }
  });
});

describe("PDF individual do cartão", () => {
  it("tem uma página com as dimensões físicas corretas, corte e sangria", async () => {
    const [pagina, ...outras] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    expect(outras).toHaveLength(0);
    expect(pontosParaMm(pagina.midia.largura)).toBeCloseTo(92, 4);
    expect(pontosParaMm(pagina.midia.altura)).toBeCloseTo(60, 4);
    expect(pagina.sangria).toEqual(pagina.midia);
    expect(pontosParaMm(pagina.corte.x)).toBeCloseTo(3, 4);
    expect(pontosParaMm(pagina.corte.y)).toBeCloseTo(3, 4);
    expect(pontosParaMm(pagina.corte.largura)).toBeCloseTo(86, 4);
    expect(pontosParaMm(pagina.corte.altura)).toBeCloseTo(54, 4);
  });

  it("o QR desenhado no PDF codifica exatamente a URL permanente", async () => {
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    expect(pagina.conteudoDoQr).toBe("https://go.example.com/c/K8M4T2");
    expect(pagina.conteudoDoQr).toBe(getCardPublicUrl("K8M4T2"));
  });

  it("o QR fica na posição e no tamanho definidos pelo modelo, sem deformação", async () => {
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    const esperado = geometriaDoModelo(google).qr;
    expect(pagina.areaDoQr.x).toBeCloseTo(esperado.x, 4);
    expect(pagina.areaDoQr.y).toBeCloseTo(esperado.y, 4);
    expect(pagina.areaDoQr.largura).toBeCloseTo(esperado.largura, 4);
    expect(pagina.areaDoQr.altura).toBeCloseTo(pagina.areaDoQr.largura, 6);
    expect(pontosParaMm(pagina.areaDoQr.largura)).toBeCloseTo(30, 4);
  });

  it("o QR é vetorial, preto puro sobre branco, com zona de silêncio de 4 módulos", async () => {
    const pdf = await gerarPdfDoCartao("K8M4T2", google);
    const [pagina] = await lerPdfDeImpressao(pdf);
    expect(pagina.zonaDeSilencioEmModulos).toBe(4);
    expect(pagina.coresDoQr).toEqual(["0 0 0 0 k", "0 0 0 1 k"]);
    // Nenhuma imagem (bitmap) em todo o arquivo: só geometria vetorial.
    expect(Buffer.from(pdf).toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("cartão do Google usa a arte do Google; cartão do Instagram usa a arte do Instagram", async () => {
    const arteGoogle = await lerArteDoModelo(await readFile("templates/google.pdf"));
    const arteInstagram = await lerArteDoModelo(await readFile("templates/instagram.pdf"));
    expect(arteGoogle).not.toBe(arteInstagram);

    const [doGoogle] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    const [doInstagram] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", instagram));
    // A arte entra inteira e sem alteração (a biblioteca só a envolve em um par q … Q).
    expect(doGoogle.arteEmbutida).toContain(arteGoogle.trim());
    expect(doGoogle.arteEmbutida).not.toContain(arteInstagram.trim());
    expect(doInstagram.arteEmbutida).toContain(arteInstagram.trim());
    expect(doInstagram.arteEmbutida).not.toContain(arteGoogle.trim());
    // O QR é o mesmo nos dois modelos: só a arte muda.
    expect(doInstagram.conteudoDoQr).toBe(doGoogle.conteudoDoQr);
  });

  it("gerar de novo produz a mesma arte e o mesmo QR", async () => {
    const [primeira] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    const [segunda] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    expect(segunda.operadores).toBe(primeira.operadores);
    expect(segunda.arteEmbutida).toBe(primeira.arteEmbutida);
  });

  it("imprime o código do cartão só quando o modelo define a posição", async () => {
    const [comCodigo] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    const [semCodigo] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", { ...google, codigo: null }));
    const depoisDoQr = (operadores: string) => operadores.slice(operadores.indexOf("EMC") + 3).trim();
    expect(depoisDoQr(comCodigo.operadores)).not.toBe("");
    expect(depoisDoQr(semCodigo.operadores)).toBe("");
    expect(semCodigo.conteudoDoQr).toBe(comCodigo.conteudoDoQr);
  });
});

describe("falhas claras na geração", () => {
  async function erroDe(promessa: Promise<unknown>): Promise<ErroDeDominio> {
    try {
      await promessa;
    } catch (erro) {
      if (erro instanceof ErroDeDominio) return erro;
      throw erro;
    }
    throw new Error("Esperava um ErroDeDominio.");
  }

  it("recusa código inválido ou URL de destino no lugar do código", async () => {
    expect((await erroDe(gerarPdfDoCartao("000001", google))).codigo).toBe("CODIGO_INVALIDO");
    expect((await erroDe(gerarPdfDoCartao("https://instagram.com/empresa", google))).codigo).toBe("CODIGO_INVALIDO");
  });

  it("recusa lista vazia", async () => {
    expect((await erroDe(gerarPdfDeImpressao([], google, "vazio"))).message).toContain("Não há cartões");
  });

  it("recusa modelo cujo arquivo de arte não existe", async () => {
    const erro = await erroDe(gerarPdfDoCartao("K8M4T2", { ...google, arquivo: "inexistente.pdf" }));
    expect(erro.codigo).toBe("MODELO_NAO_ENCONTRADO");
  });

  it("recusa arte com tamanho diferente do modelo, em vez de redimensionar", async () => {
    const erro = await erroDe(gerarPdfDoCartao("K8M4T2", { ...google, larguraFinalMm: 90 }));
    expect(erro.message).toContain("mede 92,00 × 60,00 mm");
    expect(erro.message).toContain("espera 96,00 × 60,00 mm");
  });

  it("recusa área de QR que não cabe na arte", async () => {
    const erro = await erroDe(gerarPdfDoCartao("K8M4T2", { ...google, qr: { xMm: 70, yMm: 6, tamanhoMm: 30 } }));
    expect(erro.message).toContain("não cabe");
  });

  it("recusa QR com módulos pequenos demais para leitura confiável", async () => {
    const erro = await erroDe(gerarPdfDoCartao("K8M4T2", { ...google, qr: { xMm: 50, yMm: 6, tamanhoMm: 12 } }));
    expect(erro.message).toContain("módulos menores que 0.5 mm");
  });

  it("não aceita que o domínio longo torne o QR ilegível sem avisar", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", `https://${"subdominio-muito-longo.".repeat(9)}example.com`);
    const erro = await erroDe(gerarPdfDoCartao("K8M4T2", { ...google, qr: { xMm: 50, yMm: 6, tamanhoMm: 30 } }));
    vi.unstubAllEnvs();
    expect(erro.codigo).toBe("IMPRESSAO_INVALIDA");
  });
});
