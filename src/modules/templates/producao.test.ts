// Produção com template: PDF individual, PDF do lote, controle.csv e ZIP — e a convivência com
// os lotes anteriores aos templates, que seguem pelo caminho antigo sem nenhuma mudança.
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { Lote, TemplateDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { criarLote } from "@/modules/batches/servico";
import { listarCartoesDoLote } from "@/modules/cards/repositorio";
import { configurarDestino } from "@/modules/cards/servico";
import { gerarCsvDeControle, gerarPdfDoPacote } from "@/modules/printing/producao";
import {
  carregarLoteParaProducao,
  gerarArquivoDeImpressaoDoCartao,
  planejarPacoteDoLote,
  resolverModeloDoLote,
} from "@/modules/printing/servico";
import { ArmazenamentoEmMemoria } from "@/modules/storage/memoria";
import { criarBancoDeTeste } from "../../../tests/banco-de-teste";
import { lerFixture } from "../../../tests/fixtures-de-template";
import { lerPdfDeImpressao } from "../../../tests/ler-pdf";
import { lerDesenhosDoQr, lerPaginasDoPdf } from "../../../tests/ler-pdf-de-template";
import { criarPdfDeTemplate } from "../../../tests/pdf-de-template";
import { lerQrDoSvg } from "../../../tests/ler-qr";
import { contarPaginas, lerQrDaPagina } from "../../../tests/renderizar-pdf";
import { AREA_DO_QR_NAS_FIXTURES, criarTemplatePronto } from "../../../tests/templates-de-teste";
import {
  buscarTemplateDoLote,
  carregarArquivoDoLote,
  gerarCsvDeControleComTemplate,
  gerarLeiaMeComTemplate,
  gerarPdfDoCartaoComTemplate,
  gerarPdfDoPacoteComTemplate,
  gerarZipComTemplate,
  individuaisCabemNoPacote,
  planejarPacoteComTemplate,
} from "./producao";
import { buscarTemplate, definirTemplatePadrao, inativarTemplate, listarTemplatesParaNovosLotes } from "./servico";

let db: Banco;
let armazenamento: ArmazenamentoEmMemoria;
let modelo01: TemplateDeImpressao;
let loteGoogle: Lote;
let codigos: string[];

const DESTINO = "https://g.page/r/cliente-original/review";

beforeAll(async () => {
  db = await criarBancoDeTeste();
  armazenamento = new ArmazenamentoEmMemoria();
  modelo01 = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 01", padrao: true });
  const criado = await criarLote(db, { quantidade: 5, tipo: "GOOGLE", descricao: null, templateId: modelo01.id });
  loteGoogle = criado.lote;
  // A ordem de produção é a de listarCartoesDoLote (a mesma do controle.csv e das páginas do PDF).
  codigos = (await listarCartoesDoLote(db, loteGoogle.id)).map((cartao) => cartao.codigo);
});

async function pacoteDoLote(lote: Lote) {
  const template = await buscarTemplateDoLote(db, lote);
  if (!template) throw new Error("O lote deveria ter um template.");
  const cartoes = await listarCartoesDoLote(db, lote.id);
  return {
    template,
    arquivo: await carregarArquivoDoLote(armazenamento, lote, template),
    pacote: planejarPacoteComTemplate(lote, cartoes.map((cartao) => cartao.codigo), template),
  };
}

describe("PDF individual do cartão", () => {
  it("usa o template do lote, com o nome <produto>-<CODIGO>.pdf e a página do template", async () => {
    const codigo = codigos[0];
    const arte = await gerarArquivoDeImpressaoDoCartao(db, codigo, null, () => armazenamento);
    expect(arte.nomeDoArquivo).toBe(`google-${codigo}.pdf`);
    expect(arte.template?.id).toBe(modelo01.id);

    const [original] = await lerPaginasDoPdf(lerFixture("template-google"));
    const paginas = await lerPaginasDoPdf(arte.pdf);
    expect(paginas).toHaveLength(1);
    expect(paginas[0].caixas).toEqual(original.caixas);

    const lido = await lerQrDaPagina(arte.pdf);
    expect(lido?.conteudo).toBe(`https://go.example.com/c/${codigo}`);
  });

  it("o parâmetro de modelo do caminho antigo é ignorado em lotes com template", async () => {
    const arte = await gerarArquivoDeImpressaoDoCartao(db, codigos[1], "instagram", () => armazenamento);
    expect(arte.nomeDoArquivo).toBe(`google-${codigos[1]}.pdf`);
    expect(arte.template?.nome).toBe("Google — Modelo 01");
  });

  it("o QR é a URL permanente, nunca o destino: trocar o destino não muda o PDF", async () => {
    const codigo = codigos[2];
    const antes = await gerarArquivoDeImpressaoDoCartao(db, codigo, null, () => armazenamento);

    await configurarDestino(db, { codigo, tipo: "GOOGLE", destinoUrl: DESTINO, ativar: true });
    const comDestino = await gerarArquivoDeImpressaoDoCartao(db, codigo, null, () => armazenamento);
    await configurarDestino(db, { codigo, tipo: "INSTAGRAM", destinoUrl: "https://www.instagram.com/outro.cliente" });
    const comOutroDestino = await gerarArquivoDeImpressaoDoCartao(db, codigo, null, () => armazenamento);

    // O arquivo é idêntico, byte a byte, antes e depois de configurar e de trocar o destino.
    expect(Buffer.from(comDestino.pdf).equals(Buffer.from(antes.pdf))).toBe(true);
    expect(Buffer.from(comOutroDestino.pdf).equals(Buffer.from(antes.pdf))).toBe(true);
    expect((await lerQrDaPagina(comOutroDestino.pdf))?.conteudo).toBe(`https://go.example.com/c/${codigo}`);

    const [desenho] = await lerDesenhosDoQr(comOutroDestino.pdf);
    expect(desenho.conteudo).toBe(`https://go.example.com/c/${codigo}`);
    const texto = Buffer.from(comOutroDestino.pdf).toString("latin1");
    expect(texto).not.toContain("g.page");
    expect(texto).not.toContain("instagram.com");
    // O template continua sendo o do lote (Google), mesmo com o cartão reconfigurado para Instagram.
    expect(comOutroDestino.nomeDoArquivo).toBe(`google-${codigo}.pdf`);
  });

  it("o mesmo PDF sai pelo caminho direto e pelo template preparado do pacote", async () => {
    const { arquivo, template } = await pacoteDoLote(loteGoogle);
    const direto = await gerarPdfDoCartaoComTemplate(arquivo, template, codigos[0]);
    const pelaRota = await gerarArquivoDeImpressaoDoCartao(db, codigos[0], null, () => armazenamento);
    expect(Buffer.from(direto).equals(Buffer.from(pelaRota.pdf))).toBe(true);
  });
});

describe("pacote do lote", () => {
  it("PDF do lote: lote-<produto>-<numero>.pdf, uma página por cartão, na ordem do controle", async () => {
    const { pacote, arquivo } = await pacoteDoLote(loteGoogle);
    expect(pacote.nome).toBe(`lote-google-${loteGoogle.ano}-${String(loteGoogle.sequencia).padStart(3, "0")}`);
    expect(pacote.itens.map((item) => item.codigo)).toEqual(codigos);
    expect(pacote.itens.map((item) => item.numero)).toEqual([1, 2, 3, 4, 5]);

    const pdf = await gerarPdfDoPacoteComTemplate(pacote, arquivo);
    expect(await contarPaginas(pdf)).toBe(5);

    const [original] = await lerPaginasDoPdf(lerFixture("template-google"));
    const paginas = await lerPaginasDoPdf(pdf);
    for (const pagina of paginas) expect(pagina.caixas).toEqual(original.caixas);

    // Cada página tem o QR do seu cartão — nada de várias artes na mesma folha.
    const desenhos = await lerDesenhosDoQr(pdf);
    expect(desenhos.map((desenho) => desenho.conteudo)).toEqual(codigos.map((c) => `https://go.example.com/c/${c}`));
    expect(new Set(desenhos.map((desenho) => desenho.operadores)).size).toBe(5);
    for (const numero of [1, 5]) {
      expect((await lerQrDaPagina(pdf, numero))?.conteudo).toBe(`https://go.example.com/c/${codigos[numero - 1]}`);
    }
  });

  it("controle.csv: colunas existentes mais `template`, com url_nfc = url_qr = url_permanente", async () => {
    const { pacote } = await pacoteDoLote(loteGoogle);
    const linhas = gerarCsvDeControleComTemplate(pacote).trimEnd().split("\r\n");
    expect(linhas[0]).toBe("numero,codigo,tipo,template,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr");
    expect(linhas).toHaveLength(6);

    linhas.slice(1).forEach((linha, indice) => {
      const [numero, codigo, tipo, template, urlPermanente, urlNfc, urlQr, arquivoPdf, arquivoQr] = linha.split(",");
      expect(numero).toBe(String(indice + 1));
      expect(codigo).toBe(codigos[indice]);
      expect(tipo).toBe("GOOGLE");
      expect(template).toBe("Google — Modelo 01");
      expect(urlPermanente).toBe(`https://go.example.com/c/${codigo}`);
      expect(urlNfc).toBe(urlPermanente);
      expect(urlQr).toBe(urlPermanente);
      expect(arquivoPdf).toBe(`google-${codigo}.pdf`);
      expect(arquivoQr).toBe(`${codigo}.svg`);
    });
    // O destino configurado em um dos cartões não aparece em lugar nenhum do controle.
    expect(linhas.join("\n")).not.toContain("g.page");
    expect(linhas.join("\n")).not.toContain("instagram.com");
  });

  it("o nome do template é escapado no CSV (vírgulas, aspas e fórmulas)", async () => {
    const { pacote } = await pacoteDoLote(loteGoogle);
    const comNome = (nome: string) =>
      gerarCsvDeControleComTemplate({ ...pacote, template: { ...pacote.template, nome } }).split("\r\n")[1];
    expect(comNome('Google, "verão" 2026')).toContain(',"Google, ""verão"" 2026",');
    expect(comNome("=HYPERLINK(1)")).toContain(",'=HYPERLINK(1),");
    expect(comNome("+55 11")).toContain(",'+55 11,");
  });

  it("ZIP: PDF do lote, controle, LEIA-ME, QR em SVG e os PDFs individuais", async () => {
    const { pacote, arquivo } = await pacoteDoLote(loteGoogle);
    const zip = await JSZip.loadAsync(await gerarZipComTemplate(pacote, arquivo));
    const nomes = Object.values(zip.files)
      .filter((entrada) => !entrada.dir)
      .map((entrada) => entrada.name)
      .sort();

    const pasta = pacote.nome;
    expect(nomes).toEqual(
      [
        `${pasta}/${pasta}.pdf`,
        `${pasta}/controle.csv`,
        `${pasta}/LEIA-ME.txt`,
        ...codigos.map((codigo) => `${pasta}/individuais/google-${codigo}.pdf`),
        ...codigos.map((codigo) => `${pasta}/qr/${codigo}.svg`),
      ].sort(),
    );

    const pdfDoLote = await zip.file(`${pasta}/${pasta}.pdf`)!.async("uint8array");
    expect(await contarPaginas(pdfDoLote)).toBe(5);
    expect(Buffer.from(pdfDoLote).equals(Buffer.from(await gerarPdfDoPacoteComTemplate(pacote, arquivo)))).toBe(true);

    // Individual do ZIP = individual baixado na página do cartão, e o SVG tem a mesma URL.
    const individual = await zip.file(`${pasta}/individuais/google-${codigos[3]}.pdf`)!.async("uint8array");
    const baixado = await gerarArquivoDeImpressaoDoCartao(db, codigos[3], null, () => armazenamento);
    expect(Buffer.from(individual).equals(Buffer.from(baixado.pdf))).toBe(true);
    expect(lerQrDoSvg(await zip.file(`${pasta}/qr/${codigos[3]}.svg`)!.async("string"))).toBe(
      `https://go.example.com/c/${codigos[3]}`,
    );

    const leiaMe = await zip.file(`${pasta}/LEIA-ME.txt`)!.async("string");
    expect(leiaMe).toContain("Template usado: Google — Modelo 01");
    expect(leiaMe).toContain("Página: 130,05 × 86,70 mm");
    expect(leiaMe).toContain("individuais/   um PDF por cartão");
    expect(leiaMe).toContain("O sistema preserva o PDF-base e adiciona o QR.");
    expect(await zip.file(`${pasta}/controle.csv`)!.async("string")).toBe(gerarCsvDeControleComTemplate(pacote));
  });

  it("com arte pesada, o ZIP sai sem os individuais e o LEIA-ME avisa", async () => {
    expect(individuaisCabemNoPacote(100, 300 * 1024)).toBe(true);
    expect(individuaisCabemNoPacote(100, 2 * 1024 * 1024)).toBe(false);
    expect(individuaisCabemNoPacote(1000, 8 * 1024)).toBe(true);

    const pesado = await criarTemplatePronto(db, armazenamento, {
      nome: "Google — Arte pesada",
      bytes: criarPdfDeTemplate({ pesoExtraBytes: 9 * 1024 * 1024 }).bytes,
    });
    const { lote } = await criarLote(db, { quantidade: 6, tipo: "GOOGLE", descricao: null, templateId: pesado.id });
    const { pacote, arquivo } = await pacoteDoLote(lote);

    const bytesDoZip = await gerarZipComTemplate(pacote, arquivo);
    const zip = await JSZip.loadAsync(bytesDoZip);
    const nomes = Object.keys(zip.files);
    expect(nomes.some((nome) => nome.includes("/individuais/"))).toBe(false);
    expect(nomes.filter((nome) => nome.endsWith(".svg"))).toHaveLength(6);
    expect(await zip.file(`${pacote.nome}/LEIA-ME.txt`)!.async("string")).toContain("sem PDFs individuais");
    // A arte entra uma vez só no pacote.
    expect(bytesDoZip.length).toBeLessThan(arquivo.length + 200 * 1024);
    expect(gerarLeiaMeComTemplate(pacote, false)).not.toContain("individuais/   um PDF por cartão");
  });

  it("recusa lote sem cartões, com códigos repetidos ou inválidos", async () => {
    const { template } = await pacoteDoLote(loteGoogle);
    expect(() => planejarPacoteComTemplate(loteGoogle, [], template)).toThrow("Este lote não tem cartões.");
    expect(() => planejarPacoteComTemplate(loteGoogle, ["K8M4T2", "K8M4T2"], template)).toThrow("mais de uma vez");
    expect(() => planejarPacoteComTemplate(loteGoogle, ["TESTE0"], template)).toThrow("código inválido");
  });
});

describe("o lote fica preso ao template com que foi criado", () => {
  it("continua usando o Modelo 01 depois que o Modelo 02 vira padrão e o Modelo 01 é inativado", async () => {
    const { pacote, arquivo } = await pacoteDoLote(loteGoogle);
    const pdfOriginal = await gerarPdfDoPacoteComTemplate(pacote, arquivo);
    const individualOriginal = await gerarArquivoDeImpressaoDoCartao(db, codigos[0], null, () => armazenamento);

    // Nova versão com outra arte e outra posição do QR, promovida a padrão; a antiga é inativada.
    const modelo02 = await criarTemplatePronto(db, armazenamento, {
      nome: "Google — Modelo 02",
      fixture: "template-instagram",
    });
    await definirTemplatePadrao(db, modelo02.id, true);
    await inativarTemplate(db, modelo01.id);
    expect((await buscarTemplate(db, modelo01.id))?.status).toBe("INATIVO");
    expect((await listarTemplatesParaNovosLotes(db)).some((t) => t.id === modelo01.id)).toBe(false);

    // O lote antigo ainda aponta para o Modelo 01 e regenera exatamente os mesmos arquivos.
    const depois = await pacoteDoLote(loteGoogle);
    expect(depois.template.id).toBe(modelo01.id);
    expect(depois.template.nome).toBe("Google — Modelo 01");
    const pdfDepois = await gerarPdfDoPacoteComTemplate(depois.pacote, depois.arquivo);
    expect(Buffer.from(pdfDepois).equals(Buffer.from(pdfOriginal))).toBe(true);
    const individualDepois = await gerarArquivoDeImpressaoDoCartao(db, codigos[0], null, () => armazenamento);
    expect(Buffer.from(individualDepois.pdf).equals(Buffer.from(individualOriginal.pdf))).toBe(true);
    expect(gerarCsvDeControleComTemplate(depois.pacote)).toContain(",Google — Modelo 01,");

    // Mas um lote NOVO não pode mais usar o Modelo 01, e pode usar o 02.
    await expect(
      criarLote(db, { quantidade: 1, tipo: "GOOGLE", descricao: null, templateId: modelo01.id }),
    ).rejects.toThrow("está inativo");
    const novo = await criarLote(db, { quantidade: 2, tipo: "GOOGLE", descricao: null, templateId: modelo02.id });
    const doNovo = await pacoteDoLote(novo.lote);
    expect(doNovo.template.nome).toBe("Google — Modelo 02");
    const pdfDoNovo = await gerarPdfDoPacoteComTemplate(doNovo.pacote, doNovo.arquivo);
    const [arteDoNovo] = await lerPaginasDoPdf(pdfDoNovo);
    const [arteInstagram] = await lerPaginasDoPdf(lerFixture("template-instagram"));
    expect(Buffer.from(arteDoNovo.conteudo[1].bytes).equals(Buffer.from(arteInstagram.conteudo[0].bytes))).toBe(true);
  });

  it("interrompe a geração se o arquivo não for o que o lote registrou", async () => {
    const template = await buscarTemplateDoLote(db, loteGoogle);
    await expect(
      carregarArquivoDoLote(armazenamento, { templateSha256: "0".repeat(64) }, template!),
    ).rejects.toThrow("não é o mesmo que foi registrado");
  });
});

describe("lotes anteriores aos templates", () => {
  it("sem template, o lote e seus cartões seguem pelo caminho antigo, inalterado", async () => {
    const { lote, cartoes } = await criarLote(db, { quantidade: 3, tipo: "GOOGLE", descricao: null });
    expect(lote.templateId).toBeNull();
    expect(await buscarTemplateDoLote(db, lote)).toBeNull();

    // PDF individual: arte do modelo do sistema (86 × 54 mm + sangria), com o código impresso.
    let armazenamentoConsultado = false;
    const arte = await gerarArquivoDeImpressaoDoCartao(db, cartoes[0].codigo, null, () => {
      armazenamentoConsultado = true;
      return armazenamento;
    });
    expect(armazenamentoConsultado).toBe(false);
    expect(arte.template).toBeNull();
    expect(arte.nomeDoArquivo).toBe(`google-${cartoes[0].codigo}.pdf`);
    const [pagina] = await lerPdfDeImpressao(arte.pdf);
    expect(pagina.conteudoDoQr).toBe(`https://go.example.com/c/${cartoes[0].codigo}`);
    expect(pagina.midia.largura).toBeCloseTo((92 * 72) / 25.4, 3);
    expect(pagina.corte.largura).toBeCloseTo((86 * 72) / 25.4, 3);

    // Pacote do lote: mesmo nome, mesmas colunas e mesmo PDF de antes.
    const dados = await carregarLoteParaProducao(db, lote.identificador);
    const pacote = await planejarPacoteDoLote(dados, await resolverModeloDoLote(db, dados.lote));
    expect(pacote.nome).toBe(`${lote.identificador}-google`);
    expect(gerarCsvDeControle(pacote).split("\r\n")[0]).toBe(
      "numero,codigo,tipo,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr",
    );
    expect(await lerPdfDeImpressao(await gerarPdfDoPacote(pacote))).toHaveLength(3);
  });

  it("um lote de produto sem modelo do sistema pode usar template", async () => {
    const generico = await criarTemplatePronto(db, armazenamento, { nome: "Outro — Modelo 01", tipo: "GENERICO" });
    const { lote, cartoes } = await criarLote(db, { quantidade: 2, tipo: "GENERICO", descricao: null, templateId: generico.id });
    const arte = await gerarArquivoDeImpressaoDoCartao(db, cartoes[0].codigo, null, () => armazenamento);
    expect(arte.nomeDoArquivo).toBe(`generico-${cartoes[0].codigo}.pdf`);
    const { pacote } = await pacoteDoLote(lote);
    expect(pacote.nome).toMatch(/^lote-generico-\d{4}-\d{3}$/);
    expect(AREA_DO_QR_NAS_FIXTURES.largura).toBeGreaterThan(0);
  });
});
