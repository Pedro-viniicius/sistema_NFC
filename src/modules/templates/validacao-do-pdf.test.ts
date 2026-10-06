import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "@/lib/erros";
import { mmParaPontos } from "@/modules/printing/unidades";
import { lerFixture } from "../../../tests/fixtures-de-template";
import { criarPdfDeTemplate } from "../../../tests/pdf-de-template";
import {
  MAX_TEMPLATE_BYTES,
  calcularSha256,
  descreverPdfDoTemplate,
  limparNomeDoArquivo,
  validarPdfDoTemplate,
} from "./validacao-do-pdf";

async function motivoDaRecusa(bytes: Uint8Array, nome = "arte.pdf"): Promise<string> {
  try {
    await validarPdfDoTemplate(bytes, nome);
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe("TEMPLATE_INVALIDO");
    return (erro as ErroDeDominio).message;
  }
  throw new Error("O PDF foi aceito, mas deveria ter sido recusado.");
}

describe("PDF válido", () => {
  it("aceita a arte de uma página e extrai caixas, dimensões e orientação", async () => {
    const bytes = lerFixture("template-google");
    const pdf = await validarPdfDoTemplate(bytes, "cartao_google.pdf");

    expect(pdf.numeroDePaginas).toBe(1);
    expect(pdf.rotacao).toBe(0);
    expect(pdf.mediaBox).toEqual([0, 0, 368.646, 245.764]);
    expect(pdf.cropBox).toEqual(pdf.mediaBox);
    expect(pdf.trimBox).toBeNull();
    expect(pdf.bleedBox).toBeNull();
    expect(pdf.larguraDaPaginaMm).toBeCloseTo(130.05, 2);
    expect(pdf.alturaDaPaginaMm).toBeCloseTo(86.7, 2);
    expect(pdf.orientacao).toBe("paisagem");
    expect(pdf.tamanhoBytes).toBe(bytes.length);
    expect(pdf.sha256).toBe(calcularSha256(bytes));
    expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(descreverPdfDoTemplate(pdf)).toBe("cartao_google.pdf · 1 página · 130,05 × 86,70 mm · paisagem");
  });

  it("lê a MediaBox com origem diferente de zero sem assumir (0, 0)", async () => {
    const pdf = await validarPdfDoTemplate(lerFixture("mediabox-com-origem"), "arte.pdf");
    expect(pdf.mediaBox).toEqual([100, 200, 468.646, 445.764]);
    expect(pdf.larguraDaPaginaMm).toBeCloseTo(130.05, 2);
    expect(pdf.alturaDaPaginaMm).toBeCloseTo(86.7, 2);
  });

  it("usa a CropBox como página visível quando ela é menor que a MediaBox", async () => {
    const pdf = await validarPdfDoTemplate(lerFixture("cropbox-menor"), "arte.pdf");
    expect(pdf.mediaBox).toEqual([10, 15, 418.646, 300.764]);
    expect(pdf.cropBox).toEqual([30, 35, 398.646, 280.764]);
    // As dimensões mostradas são as da página visível, não as da MediaBox.
    expect(pdf.larguraDaPaginaMm).toBeCloseTo(130.05, 2);
    expect(pdf.alturaDaPaginaMm).toBeCloseTo(86.7, 2);
  });

  it("mostra a TrimBox quando ela difere da MediaBox", async () => {
    const pdf = await validarPdfDoTemplate(criarPdfDeTemplate({ trimBoxMm: 3 }).bytes, "arte.pdf");
    expect(pdf.trimBox).not.toBeNull();
    expect(pdf.bleedBox).toEqual(pdf.mediaBox);
    expect(descreverPdfDoTemplate(pdf)).toBe(
      "arte.pdf · 1 página · 130,05 × 86,70 mm · paisagem · área de corte (TrimBox) de 124,05 × 80,70 mm",
    );
  });

  it("identifica página em retrato e quadrada", async () => {
    const retrato = await validarPdfDoTemplate(criarPdfDeTemplate({ larguraMm: 90, alturaMm: 130 }).bytes, "a.pdf");
    expect(retrato.orientacao).toBe("retrato");
    const quadrada = await validarPdfDoTemplate(criarPdfDeTemplate({ larguraMm: 100, alturaMm: 100 }).bytes, "a.pdf");
    expect(quadrada.orientacao).toBe("quadrada");
  });

  it("aceita a arte que deixa o estado gráfico desbalanceado (o gerador cuida disso)", async () => {
    await expect(validarPdfDoTemplate(lerFixture("transformacao-desbalanceada"), "arte.pdf")).resolves.toBeTruthy();
  });
});

describe("arquivos recusados", () => {
  it("não é PDF: arquivo renomeado, com qualquer Content-Type que o navegador informe", async () => {
    expect(await motivoDaRecusa(lerFixture("nao-e-pdf"), "arte.pdf")).toBe(
      "O arquivo enviado não é um PDF, apesar da extensão.",
    );
    // Imagem PNG com extensão .pdf.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await motivoDaRecusa(png, "logo.pdf")).toContain("não é um PDF");
    // A assinatura precisa estar no início do arquivo.
    const comLixoAntes = new Uint8Array([0x20, ...lerFixture("template-google")]);
    expect(await motivoDaRecusa(comLixoAntes)).toContain("não é um PDF");
  });

  it("extensão diferente de .pdf, mesmo com conteúdo de PDF", async () => {
    const pdf = lerFixture("template-google");
    for (const nome of ["arte.png", "arte", "arte.pdf.exe", "arte.pdf "]) {
      const esperado = nome.trim().toLowerCase().endsWith(".pdf") ? null : "O arquivo deve ser um PDF (extensão .pdf).";
      if (esperado) expect(await motivoDaRecusa(pdf, nome)).toBe(esperado);
      else await expect(validarPdfDoTemplate(pdf, nome)).resolves.toBeTruthy();
    }
    await expect(validarPdfDoTemplate(pdf, "ARTE.PDF")).resolves.toBeTruthy();
  });

  it("PDF truncado e PDF malformado", async () => {
    expect(await motivoDaRecusa(lerFixture("truncado"))).toBe(
      "O PDF está incompleto ou corrompido. Exporte o arquivo novamente e envie de novo.",
    );
    expect(await motivoDaRecusa(lerFixture("malformado"))).toBe(
      "O PDF está malformado e não pôde ser lido. Exporte o arquivo novamente.",
    );
    expect(await motivoDaRecusa(new Uint8Array(0))).toBe("O arquivo está vazio.");
  });

  it("PDF protegido por senha (sem tentar ignorar a criptografia)", async () => {
    expect(await motivoDaRecusa(lerFixture("protegido-por-senha"))).toBe(
      "O PDF está protegido por senha ou criptografado. Exporte o arquivo sem proteção.",
    );
  });

  it("mais de uma página, com a mensagem exata", async () => {
    expect(await motivoDaRecusa(lerFixture("duas-paginas"))).toBe("O template deve possuir apenas uma página.");
    expect(await motivoDaRecusa(criarPdfDeTemplate({ paginas: 5 }).bytes)).toBe(
      "O template deve possuir apenas uma página.",
    );
  });

  it("página rotacionada, com a mensagem exata", async () => {
    const mensagem = "Páginas rotacionadas ainda não são suportadas. Exporte o PDF sem rotação.";
    expect(await motivoDaRecusa(lerFixture("pagina-rotacionada"))).toBe(mensagem);
    for (const rotacao of [180, 270, -90]) {
      expect(await motivoDaRecusa(criarPdfDeTemplate({ rotacao }).bytes)).toBe(mensagem);
    }
    // 360° é o mesmo que sem rotação.
    await expect(validarPdfDoTemplate(criarPdfDeTemplate({ rotacao: 360 }).bytes, "a.pdf")).resolves.toBeTruthy();
  });

  it("conteúdo ativo: JavaScript, ação de execução e arquivo anexado", async () => {
    expect(await motivoDaRecusa(lerFixture("com-javascript"))).toContain("conteúdo ativo (JavaScript)");
    expect(await motivoDaRecusa(criarPdfDeTemplate({ launch: true }).bytes)).toContain("Launch");
    expect(await motivoDaRecusa(criarPdfDeTemplate({ anexo: true }).bytes)).toContain("arquivos anexados");
  });

  it("dimensões absurdas", async () => {
    expect(await motivoDaRecusa(criarPdfDeTemplate({ larguraMm: 5, alturaMm: 5 }).bytes)).toContain(
      "dimensões fora do aceito",
    );
    expect(await motivoDaRecusa(criarPdfDeTemplate({ larguraMm: 3000, alturaMm: 100 }).bytes)).toContain(
      "dimensões fora do aceito",
    );
  });

  it("arquivo maior que o limite", async () => {
    expect(MAX_TEMPLATE_BYTES).toBe(25 * 1024 * 1024);
    const noLimite = criarPdfDeTemplate({ pesoExtraBytes: MAX_TEMPLATE_BYTES - 6000 }).bytes;
    expect(noLimite.length).toBeLessThanOrEqual(MAX_TEMPLATE_BYTES);
    await expect(validarPdfDoTemplate(noLimite, "pesado.pdf")).resolves.toBeTruthy();

    const grande = criarPdfDeTemplate({ pesoExtraBytes: MAX_TEMPLATE_BYTES }).bytes;
    expect(await motivoDaRecusa(grande, "pesado.pdf")).toBe(
      "O arquivo tem 25,0 MB. O tamanho máximo de um template é 25 MB.",
    );
  });
});

describe("nome do arquivo", () => {
  it("remove caminhos, caracteres de controle e símbolos perigosos", () => {
    expect(limparNomeDoArquivo("C:\\Users\\ana\\arte final.pdf")).toBe("arte final.pdf");
    expect(limparNomeDoArquivo("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(limparNomeDoArquivo('<img src=x onerror="a">.pdf')).toBe("img src=x onerror=a.pdf");
    expect(limparNomeDoArquivo("arte\u0000\r\n\u202egpj.pdf")).toBe("artegpj.pdf");
    expect(limparNomeDoArquivo("cartão_açaí.pdf")).toBe("cartão_açaí.pdf");
    expect(limparNomeDoArquivo("   ")).toBe("template.pdf");
    expect(limparNomeDoArquivo(`${"a".repeat(300)}.pdf`)).toHaveLength(120);
  });

  it("um tamanho coerente com as medidas em pontos", () => {
    expect(mmParaPontos(130.05)).toBeCloseTo(368.646, 3);
  });
});
