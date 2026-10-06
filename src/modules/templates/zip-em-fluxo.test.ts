import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { juntarFluxo, zipEmFluxo, type EntradaDoZip } from "./zip-em-fluxo";

/** Bytes pseudoaleatórios (não comprimíveis), como o conteúdo de um PDF com imagem. */
function bytes(tamanho: number, semente = 7): Uint8Array {
  const dados = new Uint8Array(tamanho);
  for (let i = 0, x = semente; i < tamanho; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    dados[i] = x & 0xff;
  }
  return dados;
}

describe("ZIP em fluxo", () => {
  it("gera um ZIP que uma biblioteca de ZIP independente abre, com o conteúdo exato", async () => {
    const pdf = bytes(700_000);
    const csv = "numero,codigo\r\n1,K8M4T2\r\n".repeat(200);
    const zip = await juntarFluxo(
      zipEmFluxo([
        { nome: "lote-google-2026-001/lote-google-2026-001.pdf", dados: pdf },
        { nome: "lote-google-2026-001/controle.csv", dados: csv, comprimir: true },
        { nome: "lote-google-2026-001/LEIA-ME.txt", dados: "Página: 130,05 × 86,70 mm — atenção à gravação", comprimir: true },
        { nome: "lote-google-2026-001/qr/K8M4T2.svg", dados: "<svg/>", comprimir: true },
        { nome: "pasta com acentuação/arquivo vazio.txt", dados: new Uint8Array(0) },
      ]),
    );

    const lido = await JSZip.loadAsync(zip, { checkCRC32: true });
    expect(Object.keys(lido.files).filter((nome) => !lido.files[nome].dir)).toEqual([
      "lote-google-2026-001/lote-google-2026-001.pdf",
      "lote-google-2026-001/controle.csv",
      "lote-google-2026-001/LEIA-ME.txt",
      "lote-google-2026-001/qr/K8M4T2.svg",
      "pasta com acentuação/arquivo vazio.txt",
    ]);
    const pdfLido = await lido.file("lote-google-2026-001/lote-google-2026-001.pdf")!.async("uint8array");
    expect(Buffer.from(pdfLido).equals(Buffer.from(pdf))).toBe(true);
    expect(await lido.file("lote-google-2026-001/controle.csv")!.async("string")).toBe(csv);
    expect(await lido.file("lote-google-2026-001/LEIA-ME.txt")!.async("string")).toContain("130,05 × 86,70 mm — atenção");
    expect(await lido.file("pasta com acentuação/arquivo vazio.txt")!.async("string")).toBe("");

    // Texto comprimido ocupa bem menos; o PDF não é recomprimido (fica do mesmo tamanho).
    expect(zip.length).toBeLessThan(pdf.length + 2000);
    expect(zip.length).toBeGreaterThan(pdf.length);
  });

  it("produz os arquivos só quando o leitor pede: a memória não cresce com o tamanho do pacote", async () => {
    let produzidos = 0;
    async function* entradas(): AsyncGenerator<EntradaDoZip> {
      for (let i = 0; i < 50; i++) {
        produzidos++;
        yield { nome: `individuais/google-${i}.pdf`, dados: bytes(300_000, i + 1) };
      }
    }
    const leitor = zipEmFluxo(entradas()).getReader();
    // Lê só o começo do fluxo: os demais arquivos ainda não foram gerados.
    for (let i = 0; i < 3; i++) await leitor.read();
    expect(produzidos).toBeLessThanOrEqual(3);

    // Download interrompido: a geração para.
    await leitor.cancel();
    const noCancelamento = produzidos;
    await new Promise((resolver) => setTimeout(resolver, 20));
    expect(produzidos).toBe(noCancelamento);
    expect(produzidos).toBeLessThan(50);
  });

  it("entrega o conteúdo em pedaços pequenos", async () => {
    const leitor = zipEmFluxo([{ nome: "grande.pdf", dados: bytes(2_000_000) }]).getReader();
    let maior = 0;
    let total = 0;
    for (let leitura = await leitor.read(); !leitura.done; leitura = await leitor.read()) {
      maior = Math.max(maior, leitura.value.length);
      total += leitura.value.length;
    }
    expect(maior).toBeLessThanOrEqual(256 * 1024);
    expect(total).toBeGreaterThan(2_000_000);
  });

  it("muitos arquivos: 1.000 QR Codes e 1.000 PDFs no mesmo ZIP", async () => {
    function* entradas(): Generator<EntradaDoZip> {
      for (let i = 0; i < 1000; i++) {
        yield { nome: `individuais/google-${i}.pdf`, dados: bytes(2000, i + 1) };
        yield { nome: `qr/${i}.svg`, dados: `<svg>${i}</svg>`, comprimir: true };
      }
    }
    const lido = await JSZip.loadAsync(await juntarFluxo(zipEmFluxo(entradas())), { checkCRC32: true });
    expect(Object.keys(lido.files).filter((nome) => !lido.files[nome].dir)).toHaveLength(2000);
    expect(await lido.file("qr/999.svg")!.async("string")).toBe("<svg>999</svg>");
    const pdf = await lido.file("individuais/google-512.pdf")!.async("uint8array");
    expect(Buffer.from(pdf).equals(Buffer.from(bytes(2000, 513)))).toBe(true);
  });

  it("recusa nomes repetidos ou que sairiam da pasta", async () => {
    for (const nomes of [["a.pdf", "a.pdf"], ["../fora.pdf"], ["/raiz.pdf"], ["a//b.pdf"], ["a\\b.pdf"], [""]]) {
      const fluxo = zipEmFluxo(nomes.map((nome) => ({ nome, dados: "x" })));
      await expect(juntarFluxo(fluxo), nomes.join()).rejects.toThrow("Nome de arquivo inválido ou repetido");
    }
  });

  it("um erro ao gerar um arquivo interrompe o fluxo (o download falha em vez de sair pela metade)", async () => {
    async function* entradas(): AsyncGenerator<EntradaDoZip> {
      yield { nome: "a.pdf", dados: "a" };
      throw new Error("falha ao gerar o cartão");
    }
    await expect(juntarFluxo(zipEmFluxo(entradas()))).rejects.toThrow("falha ao gerar o cartão");
  });
});
