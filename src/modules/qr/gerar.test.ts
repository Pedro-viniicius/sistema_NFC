import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { gradeVazia, lerQrDaGrade, lerQrDoPng, lerQrDoSvg } from "../../../tests/ler-qr";
import {
  ZONA_DE_SILENCIO_EM_MODULOS,
  agruparEmFaixas,
  conteudoDoQr,
  gerarMatrizDoQr,
  gerarQrPng,
  gerarQrSvg,
  nomeDoArquivoQr,
} from "./gerar";

describe("QR Code do cartão", () => {
  it("codifica exatamente a URL permanente", async () => {
    expect(conteudoDoQr("K8M4T2")).toBe("https://go.example.com/c/K8M4T2");
    const png = await gerarQrPng("K8M4T2");
    expect(lerQrDoPng(png)).toBe("https://go.example.com/c/K8M4T2");
  });

  it("gera SVG vetorial com zona de silêncio de 4 módulos", async () => {
    const svg = await gerarQrSvg("K8M4T2");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<image");

    const modulos = QRCode.create(conteudoDoQr("K8M4T2"), { errorCorrectionLevel: "M" }).modules.size;
    const lado = modulos + 2 * ZONA_DE_SILENCIO_EM_MODULOS;
    expect(ZONA_DE_SILENCIO_EM_MODULOS).toBeGreaterThanOrEqual(4);
    expect(svg).toContain(`viewBox="0 0 ${lado} ${lado}"`);
  });

  it("não aceita gerar QR para algo que não seja um código de cartão", async () => {
    await expect(async () => gerarQrSvg("https://instagram.com/empresa")).rejects.toThrow(
      "Código de cartão inválido",
    );
    await expect(async () => gerarQrPng("")).rejects.toThrow();
  });

  it("usa o nome de arquivo padrão", () => {
    expect(nomeDoArquivoQr("A8K4P2", "svg")).toBe("qr-A8K4P2.svg");
    expect(nomeDoArquivoQr("A8K4P2", "png")).toBe("qr-A8K4P2.png");
  });

  it("o SVG avulso codifica a URL permanente", async () => {
    expect(lerQrDoSvg(await gerarQrSvg("K8M4T2"))).toBe("https://go.example.com/c/K8M4T2");
    expect(lerQrDoSvg(await gerarQrSvg("7PN3RX"))).toBe("https://go.example.com/c/7PN3RX");
  });

  it("o SVG usa apenas retângulos pretos preenchidos sobre fundo branco", async () => {
    const svg = await gerarQrSvg("K8M4T2");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('<path fill="#000000"');
    expect(svg).not.toMatch(/stroke|gradient|transform|rotate|<image|rx=/);
    expect(await gerarQrSvg("K8M4T2")).toBe(svg);
  });
});

describe("matriz vetorial do QR", () => {
  it("é quadrada, tem os três marcadores de canto e codifica a URL permanente", () => {
    const matriz = gerarMatrizDoQr("K8M4T2");
    expect(matriz.linhas).toHaveLength(matriz.lado);
    expect(matriz.linhas.every((linha) => linha.length === matriz.lado)).toBe(true);
    expect((matriz.lado - 17) % 4).toBe(0);

    const margem = ZONA_DE_SILENCIO_EM_MODULOS;
    const grade = gradeVazia(matriz.lado + 2 * margem);
    matriz.linhas.forEach((linha, y) => linha.forEach((escuro, x) => (grade[y + margem][x + margem] = escuro)));
    expect(lerQrDaGrade(grade)).toBe("https://go.example.com/c/K8M4T2");
  });

  it("agrupa os módulos em faixas sem perder nem criar módulos", () => {
    const matriz = gerarMatrizDoQr("K8M4T2");
    const reconstruida = gradeVazia(matriz.lado);
    for (const faixa of agruparEmFaixas(matriz)) {
      expect(faixa.largura).toBeGreaterThan(0);
      for (let i = 0; i < faixa.largura; i++) {
        expect(reconstruida[faixa.linha][faixa.coluna + i]).toBe(false);
        reconstruida[faixa.linha][faixa.coluna + i] = true;
      }
    }
    expect(reconstruida).toEqual(matriz.linhas);
  });

  it("recusa qualquer coisa que não seja um código de cartão", () => {
    expect(() => gerarMatrizDoQr("https://instagram.com/empresa")).toThrow("Código de cartão inválido");
  });
});
