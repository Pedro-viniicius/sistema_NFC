import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { lerQrDoPng } from "../../../tests/ler-qr";
import {
  ZONA_DE_SILENCIO_EM_MODULOS,
  conteudoDoQr,
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
});
