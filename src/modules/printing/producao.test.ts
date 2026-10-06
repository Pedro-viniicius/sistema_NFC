import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { criarLote } from "@/modules/batches/servico";
import { gerarCodigo } from "@/modules/cards/codigo";
import { buscarCartaoPorCodigo, listarCartoesDoLote } from "@/modules/cards/repositorio";
import { configurarDestino, criarCartaoComCodigo } from "@/modules/cards/servico";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { lerPdfDeImpressao } from "../../../tests/ler-pdf";
import { lerQrDoSvg } from "../../../tests/ler-qr";
import { obterModelo, type ModeloDeImpressao } from "./modelos";
import { gerarPdfDoCartao } from "./pdf";
import {
  MAXIMO_DE_CARTOES_POR_PACOTE,
  escolherModelo,
  gerarCsvDeControle,
  gerarLeiaMe,
  gerarPdfDoPacote,
  gerarZipDoPacote,
  nomeDeArquivoSeguro,
  nomeDoPdfDoCartao,
  planejarPacote,
  totalDePartes,
} from "./producao";

const google = obterModelo("GOOGLE") as ModeloDeImpressao;
const instagram = obterModelo("INSTAGRAM") as ModeloDeImpressao;

const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";
const CODIGOS = ["K8M4T2", "7PN3RX", "Q4TZ8M"];

function codigosUnicos(quantidade: number): string[] {
  const codigos = new Set<string>();
  while (codigos.size < quantidade) codigos.add(gerarCodigo());
  return [...codigos];
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeDominio> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeDominio) return erro;
    throw erro;
  }
  throw new Error("Esperava um ErroDeDominio.");
}

function pacoteDeTeste(modelo = google, codigos = CODIGOS) {
  return planejarPacote({ identificadorDoLote: "lote-2026-001", codigos, modelo });
}

describe("PDF consolidado do lote", () => {
  it("tem uma página por cartão, na ordem do lote, cada uma com o QR do seu cartão", async () => {
    const paginas = await lerPdfDeImpressao(await gerarPdfDoPacote(await pacoteDeTeste()));
    expect(paginas).toHaveLength(3);
    expect(paginas.map((pagina) => pagina.conteudoDoQr)).toEqual(CODIGOS.map(getCardPublicUrl));
    expect(new Set(paginas.map((pagina) => pagina.conteudoDoQr)).size).toBe(3);
  });

  it("todas as páginas usam a mesma arte, o mesmo tamanho e a mesma posição de QR", async () => {
    const [primeira, ...demais] = await lerPdfDeImpressao(await gerarPdfDoPacote(await pacoteDeTeste()));
    for (const pagina of demais) {
      expect(pagina.arteEmbutida).toBe(primeira.arteEmbutida);
      expect(pagina.midia).toEqual(primeira.midia);
      expect(pagina.corte).toEqual(primeira.corte);
      expect(pagina.areaDoQr).toEqual(primeira.areaDoQr);
    }
  });

  it("a página do lote é igual ao PDF individual do mesmo cartão", async () => {
    const [doLote] = await lerPdfDeImpressao(await gerarPdfDoPacote(await pacoteDeTeste()));
    const [individual] = await lerPdfDeImpressao(await gerarPdfDoCartao("K8M4T2", google));
    expect(individual.operadores).toBe(doLote.operadores);
    expect(individual.arteEmbutida).toBe(doLote.arteEmbutida);
  });
});

describe("planilha de controle", () => {
  it("lista número, código, tipo, URLs e arquivos de cada cartão", async () => {
    const csv = gerarCsvDeControle(await pacoteDeTeste());
    expect(csv).toBe(
      [
        "numero,codigo,tipo,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr",
        `1,K8M4T2,GOOGLE,${URL_PERMANENTE},${URL_PERMANENTE},${URL_PERMANENTE},google-K8M4T2.pdf,K8M4T2.svg`,
        "2,7PN3RX,GOOGLE,https://go.example.com/c/7PN3RX,https://go.example.com/c/7PN3RX,https://go.example.com/c/7PN3RX,google-7PN3RX.pdf,7PN3RX.svg",
        "3,Q4TZ8M,GOOGLE,https://go.example.com/c/Q4TZ8M,https://go.example.com/c/Q4TZ8M,https://go.example.com/c/Q4TZ8M,google-Q4TZ8M.pdf,Q4TZ8M.svg",
        "",
      ].join("\r\n"),
    );
  });

  it("em toda linha a URL do NFC é idêntica à URL do QR e à URL permanente", async () => {
    const pacote = await pacoteDeTeste(instagram, codigosUnicos(40));
    const [cabecalho, ...linhas] = gerarCsvDeControle(pacote).trimEnd().split("\r\n");
    const colunas = cabecalho.split(",");
    expect(linhas).toHaveLength(40);
    for (const linha of linhas) {
      const valores = Object.fromEntries(linha.split(",").map((valor, indice) => [colunas[indice], valor]));
      expect(valores.url_nfc).toBe(valores.url_qr);
      expect(valores.url_nfc).toBe(valores.url_permanente);
      expect(valores.url_nfc).toBe(getCardPublicUrl(valores.codigo));
      expect(valores.tipo).toBe("INSTAGRAM");
      expect(valores.arquivo_pdf).toBe(`instagram-${valores.codigo}.pdf`);
    }
  });

  it("é determinística", async () => {
    expect(gerarCsvDeControle(await pacoteDeTeste())).toBe(gerarCsvDeControle(await pacoteDeTeste()));
  });
});

describe("ZIP completo do pacote", () => {
  it("contém o PDF do lote, o controle, as instruções, um PDF e um SVG por cartão", async () => {
    const pacote = await pacoteDeTeste();
    const zip = await JSZip.loadAsync(await gerarZipDoPacote(pacote));
    const arquivos = Object.values(zip.files)
      .filter((arquivo) => !arquivo.dir)
      .map((arquivo) => arquivo.name)
      .sort();
    expect(arquivos).toEqual(
      [
        "lote-2026-001-google/LEIA-ME.txt",
        "lote-2026-001-google/controle.csv",
        "lote-2026-001-google/individuais/google-7PN3RX.pdf",
        "lote-2026-001-google/individuais/google-K8M4T2.pdf",
        "lote-2026-001-google/individuais/google-Q4TZ8M.pdf",
        "lote-2026-001-google/lote-2026-001-google.pdf",
        "lote-2026-001-google/qr/7PN3RX.svg",
        "lote-2026-001-google/qr/K8M4T2.svg",
        "lote-2026-001-google/qr/Q4TZ8M.svg",
      ].sort(),
    );
  });

  it("os arquivos de dentro do ZIP são coerentes entre si", async () => {
    const pacote = await pacoteDeTeste();
    const zip = await JSZip.loadAsync(await gerarZipDoPacote(pacote));
    const ler = (nome: string) => zip.file(`lote-2026-001-google/${nome}`);

    expect(await ler("controle.csv")?.async("string")).toBe(gerarCsvDeControle(pacote));
    expect(await ler("LEIA-ME.txt")?.async("string")).toBe(gerarLeiaMe(pacote));

    const svg = (await ler("qr/K8M4T2.svg")?.async("string")) ?? "";
    expect(lerQrDoSvg(svg)).toBe(URL_PERMANENTE);

    const individual = await ler("individuais/google-K8M4T2.pdf")?.async("uint8array");
    const [pagina] = await lerPdfDeImpressao(individual ?? new Uint8Array());
    expect(pagina.conteudoDoQr).toBe(URL_PERMANENTE);

    const doLote = await ler("lote-2026-001-google.pdf")?.async("uint8array");
    expect(await lerPdfDeImpressao(doLote ?? new Uint8Array())).toHaveLength(3);
  });

  it("as instruções informam medidas, limitações e como gravar o NFC", async () => {
    const leiaMe = gerarLeiaMe(await pacoteDeTeste());
    expect(leiaMe).toContain("86 x 54 mm");
    expect(leiaMe).toContain("3 mm em cada lado (arte de 92 x 60 mm)");
    expect(leiaMe).toContain("não é um PDF/X certificado");
    expect(leiaMe).toContain("url_nfc");
  });
});

describe("escolha do modelo", () => {
  it("usa o tipo do lote ou do cartão quando há arte para ele", () => {
    expect(escolherModelo(null, "GOOGLE")).toBe(google);
    expect(escolherModelo(undefined, "INSTAGRAM")).toBe(instagram);
    expect(escolherModelo(null, null, "GENERICO", "INSTAGRAM")).toBe(instagram);
  });

  it("o modelo pedido explicitamente tem prioridade", () => {
    expect(escolherModelo("instagram", "GOOGLE")).toBe(instagram);
  });

  it("falha com clareza quando não há modelo ou o modelo pedido não existe", () => {
    expect(() => escolherModelo(null, "GENERICO")).toThrow("Escolha o modelo");
    expect(() => escolherModelo(null, null)).toThrow("Escolha o modelo");
    expect(() => escolherModelo("tiktok", "GOOGLE")).toThrow("desconhecido");
    expect(() => escolherModelo("../../etc/passwd", "GOOGLE")).toThrow("desconhecido");
  });

  it("gera nomes de arquivo previsíveis e seguros", () => {
    expect(nomeDoPdfDoCartao(google, "K8M4T2")).toBe("google-K8M4T2.pdf");
    expect(nomeDoPdfDoCartao(instagram, "K8M4T2")).toBe("instagram-K8M4T2.pdf");
    for (const perigoso of ["../segredo.pdf", 'a".pdf', "a\r\nb.pdf", "a b.pdf", "", ".oculto"]) {
      expect(() => nomeDeArquivoSeguro(perigoso)).toThrow("Nome de arquivo inválido");
    }
  });
});

describe("validação antes de gerar", () => {
  it("recusa lote sem cartões", async () => {
    expect((await erroDe(pacoteDeTeste(google, []))).message).toBe("Este lote não tem cartões.");
  });

  it("recusa código inválido e código repetido", async () => {
    expect((await erroDe(pacoteDeTeste(google, ["K8M4T2", "000001"]))).message).toContain("código inválido");
    expect((await erroDe(pacoteDeTeste(google, ["K8M4T2", "7PN3RX", "K8M4T2"]))).message).toContain(
      "K8M4T2 mais de uma vez",
    );
  });

  it("recusa identificador de lote fora do padrão", async () => {
    const erro = await erroDe(
      planejarPacote({ identificadorDoLote: "../../lote", codigos: CODIGOS, modelo: google }),
    );
    expect(erro.message).toBe("Identificador de lote inválido.");
  });

  it("recusa modelo sem arquivo de arte, com QR fora da arte ou QR ilegível", async () => {
    expect((await erroDe(pacoteDeTeste({ ...google, arquivo: "nao-existe.pdf" }))).codigo).toBe(
      "MODELO_NAO_ENCONTRADO",
    );
    expect(
      (await erroDe(pacoteDeTeste({ ...google, qr: { xMm: 70, yMm: 6, tamanhoMm: 30 } }))).message,
    ).toContain("não cabe");
    expect(
      (await erroDe(pacoteDeTeste({ ...google, qr: { xMm: 50, yMm: 6, tamanhoMm: 12 } }))).message,
    ).toContain("módulos menores");
  });

  it("recusa gerar quando a URL permanente não pode ser montada", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const erro = await erroDe(pacoteDeTeste());
    vi.unstubAllEnvs();
    expect(erro.message).toContain("URL permanente do cartão K8M4T2");
    expect(erro.message).toContain("NEXT_PUBLIC_APP_URL");
  });
});

describe("limite por pacote", () => {
  it("o limite inicial é de 100 cartões", () => {
    expect(MAXIMO_DE_CARTOES_POR_PACOTE).toBe(100);
    expect(totalDePartes(1)).toBe(1);
    expect(totalDePartes(100)).toBe(1);
    expect(totalDePartes(101)).toBe(2);
    expect(totalDePartes(1000)).toBe(10);
  });

  it("lote de até 100 cartões cabe em um pacote único", async () => {
    const pacote = await pacoteDeTeste(google, codigosUnicos(100));
    expect(pacote.totalDePartes).toBe(1);
    expect(pacote.itens).toHaveLength(100);
    expect(pacote.nome).toBe("lote-2026-001-google");
  });

  it("lote maior é dividido em partes, com numeração contínua e sem repetir cartões", async () => {
    const codigos = codigosUnicos(230);
    const partes = await Promise.all(
      [1, 2, 3].map((parte) =>
        planejarPacote({ identificadorDoLote: "lote-2026-007", codigos, modelo: google, parte }),
      ),
    );
    expect(partes.map((parte) => parte.itens.length)).toEqual([100, 100, 30]);
    expect(partes.map((parte) => parte.nome)).toEqual([
      "lote-2026-007-google-parte-01",
      "lote-2026-007-google-parte-02",
      "lote-2026-007-google-parte-03",
    ]);
    expect(partes[1].itens[0].numero).toBe(101);
    expect(partes[2].itens.at(-1)?.numero).toBe(230);
    expect(partes.flatMap((parte) => parte.itens.map((item) => item.codigo))).toEqual(codigos);
  });

  it("recusa parte inexistente e pacote acima do limite", async () => {
    const codigos = codigosUnicos(150);
    const pedir = (parte: number) =>
      planejarPacote({ identificadorDoLote: "lote-2026-007", codigos, modelo: google, parte });
    expect((await erroDe(pedir(3))).message).toContain("2 partes de até 100 cartões");
    expect((await erroDe(pedir(0))).message).toContain("Parte inválida");
    expect((await erroDe(pedir(1.5))).message).toContain("Parte inválida");

    const pacote = await pedir(1);
    const inflado = { ...pacote, itens: [...pacote.itens, ...pacote.itens] };
    expect((await erroDe(gerarPdfDoPacote(inflado))).message).toContain("de 1 a 100 cartões");
    expect((await erroDe(gerarZipDoPacote(inflado))).message).toContain("de 1 a 100 cartões");
  });

  it("um pacote cheio fica bem abaixo do limite de 4,5 MB por resposta da Vercel", async () => {
    const zip = await gerarZipDoPacote(await pacoteDeTeste(google, codigosUnicos(100)));
    expect(zip.byteLength).toBeLessThan(3.5 * 1024 * 1024);
  });
});

describe("REGRESSÃO CRÍTICA: o destino nunca entra no arquivo de impressão", () => {
  let db: Banco;

  beforeAll(async () => {
    db = await criarBancoDeTeste();
  });

  async function qrDoPdf(codigo: string): Promise<string | null> {
    const cartao = await buscarCartaoPorCodigo(db, codigo);
    if (!cartao) throw new Error("cartão não encontrado");
    const [pagina] = await lerPdfDeImpressao(await gerarPdfDoCartao(cartao.codigo, escolherModelo(null, cartao.tipo)));
    return pagina.conteudoDoQr;
  }

  it("K8M4T2: trocar o destino não muda o QR do PDF, o código nem a arte", async () => {
    const original = await criarCartaoComCodigo(db, "K8M4T2");
    await configurarDestino(db, {
      codigo: "K8M4T2",
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/companyA",
    });

    const pdfAntes = await gerarPdfDoCartao("K8M4T2", google);
    expect(await qrDoPdf("K8M4T2")).toBe(URL_PERMANENTE);
    expect(Buffer.from(pdfAntes).toString("latin1")).not.toContain("instagram.com");

    await configurarDestino(db, {
      codigo: "K8M4T2",
      tipo: "GOOGLE",
      destinoUrl: "https://g.page/r/example/review",
    });

    const pdfDepois = await gerarPdfDoCartao("K8M4T2", google);
    expect(await qrDoPdf("K8M4T2")).toBe(URL_PERMANENTE);

    const [antes] = await lerPdfDeImpressao(pdfAntes);
    const [depois] = await lerPdfDeImpressao(pdfDepois);
    expect(depois.conteudoDoQr).toBe(URL_PERMANENTE);
    expect(depois.operadores).toBe(antes.operadores);
    expect(depois.arteEmbutida).toBe(antes.arteEmbutida);

    const atual = await buscarCartaoPorCodigo(db, "K8M4T2");
    expect(atual?.codigo).toBe("K8M4T2");
    expect(atual?.id).toBe(original.id);
    expect(atual?.destinoUrl).toBe("https://g.page/r/example/review");
  });

  it("pacote de um lote real: QR, CSV e NFC apontam para a URL permanente, não para os destinos", async () => {
    const { lote, cartoes } = await criarLote(db, { quantidade: 6, tipo: "GOOGLE", descricao: null });
    for (const [indice, cartao] of cartoes.entries()) {
      await configurarDestino(db, {
        codigo: cartao.codigo,
        tipo: "GOOGLE",
        destinoUrl: `https://g.page/r/cliente${indice}/review`,
      });
    }

    const doBanco = await listarCartoesDoLote(db, lote.id);
    const pacote = await planejarPacote({
      identificadorDoLote: lote.identificador,
      codigos: doBanco.map((cartao) => cartao.codigo),
      modelo: escolherModelo(null, lote.tipo),
    });

    const paginas = await lerPdfDeImpressao(await gerarPdfDoPacote(pacote));
    expect(paginas.map((pagina) => pagina.conteudoDoQr)).toEqual(
      doBanco.map((cartao) => getCardPublicUrl(cartao.codigo)),
    );

    const zip = Buffer.from(await gerarZipDoPacote(pacote));
    const csv = gerarCsvDeControle(pacote);
    expect(csv).not.toContain("g.page");
    expect(csv).not.toContain("cliente");
    const descompactado = await JSZip.loadAsync(zip);
    for (const arquivo of Object.values(descompactado.files).filter((a) => !a.dir)) {
      expect((await arquivo.async("nodebuffer")).toString("latin1")).not.toContain("g.page");
    }
    // Os códigos continuam únicos e iguais aos do banco.
    expect(new Set(pacote.itens.map((item) => item.codigo)).size).toBe(6);
  });
});
