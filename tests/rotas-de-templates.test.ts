// Rotas dos templates de impressão: envio, confirmação, arquivo original, PDF de teste e downloads
// de produção. A sessão é a de verdade (cookie com JWT assinado + consulta ao banco): só o leitor
// de cookies do Next e o armazenamento (em memória) são substituídos.
import { getPayloadFromClientToken } from "@vercel/blob/client";
import JSZip from "jszip";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Banco } from "@/db/tipos";
import { criarOuAtualizarAdministrador } from "@/modules/auth/servico";
import { COOKIE_DE_SESSAO, assinarTokenDeSessao } from "@/modules/auth/token";
import { criarLote } from "@/modules/batches/servico";
import { ArmazenamentoEmMemoria } from "@/modules/storage/memoria";
import { buscarTemplate, listarTemplates } from "@/modules/templates/servico";
import { criarBancoDeTeste } from "./banco-de-teste";
import { lerFixture } from "./fixtures-de-template";
import { criarPdfDeTemplate } from "./pdf-de-template";
import { contarPaginas, lerQrDaPagina } from "./renderizar-pdf";
import { criarTemplatePronto, enviarArquivo } from "./templates-de-teste";

const estado = vi.hoisted(() => ({
  db: undefined as unknown,
  armazenamento: undefined as unknown,
  modo: "vercel-blob" as "vercel-blob" | "local",
  cookie: undefined as string | undefined,
}));

vi.mock("@/db/cliente", () => ({ obterBanco: () => estado.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (estado.cookie === undefined ? undefined : { name: nome, value: estado.cookie }),
  }),
}));
vi.mock("@/modules/storage", () => ({
  obterArmazenamento: () => estado.armazenamento,
  modoDeArmazenamento: () => estado.modo,
}));

import { GET as baixarArteDoCartao } from "@/app/admin/cartoes/[codigo]/impressao/route";
import { GET as baixarDoLote } from "@/app/admin/lotes/[identificador]/grafica/baixar/route";
import { GET as arquivoDoTemplate } from "@/app/admin/templates-impressao/[id]/arquivo/route";
import { GET as testeDoTemplate } from "@/app/admin/templates-impressao/[id]/teste/route";
import { POST as confirmarEnvio } from "@/app/api/templates-impressao/confirmar/route";
import { PUT as envioLocal } from "@/app/api/templates-impressao/envio-local/route";
import { POST as tokenDeEnvio } from "@/app/api/templates-impressao/upload/route";

const SEGREDO = new TextEncoder().encode(process.env.AUTH_SECRET);
const BASE = "https://go.example.com";

let db: Banco;
let armazenamento: ArmazenamentoEmMemoria;
let cookieDoAdmin: string;

beforeAll(async () => {
  db = await criarBancoDeTeste();
  armazenamento = new ArmazenamentoEmMemoria();
  estado.db = db;
  estado.armazenamento = armazenamento;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_lojadeteste_segredoDeTeste123";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const admin = await criarOuAtualizarAdministrador(db, "admin@exemplo.com.br", "senha-de-teste-bem-longa-123");
  cookieDoAdmin = await assinarTokenDeSessao(admin.id, SEGREDO);
});

beforeEach(() => {
  estado.cookie = cookieDoAdmin;
  estado.modo = "vercel-blob";
});

const json = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

const pedidoDeToken = (caminho = "templates-impressao/template.pdf") => ({
  type: "blob.generate-client-token",
  payload: { pathname: caminho, multipart: false, clientPayload: null },
});

const pedirToken = (corpo: unknown = pedidoDeToken()) =>
  tokenDeEnvio(new Request(`${BASE}/api/templates-impressao/upload`, json(corpo)));
const confirmar = (corpo: unknown) =>
  confirmarEnvio(new Request(`${BASE}/api/templates-impressao/confirmar`, json(corpo)));
const enviarLocal = (bytes: Uint8Array) =>
  envioLocal(
    new Request(`${BASE}/api/templates-impressao/envio-local`, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.from(bytes),
    }),
  );
const arquivo = (id: string, consulta = "") =>
  arquivoDoTemplate(new Request(`${BASE}/admin/templates-impressao/${id}/arquivo${consulta}`), {
    params: Promise.resolve({ id }),
  });
const teste = (id: string, consulta = "") =>
  testeDoTemplate(new Request(`${BASE}/admin/templates-impressao/${id}/teste${consulta}`), {
    params: Promise.resolve({ id }),
  });
const doLote = (identificador: string, consulta = "") =>
  baixarDoLote(new Request(`${BASE}/admin/lotes/${identificador}/grafica/baixar${consulta}`), {
    params: Promise.resolve({ identificador }),
  });
const doCartao = (codigo: string, consulta = "") =>
  baixarArteDoCartao(new Request(`${BASE}/admin/cartoes/${codigo}/impressao${consulta}`), {
    params: Promise.resolve({ codigo }),
  });

describe("quem não é administrador não envia, não confirma e não baixa nada", () => {
  const ID = "00000000-0000-4000-8000-000000000000";

  async function esperarRecusaEmTodasAsRotas(): Promise<void> {
    const chave = await enviarArquivo(armazenamento, lerFixture("template-google"));
    const antes = (await listarTemplates(db)).length;
    const respostas = await Promise.all([
      pedirToken(),
      confirmar({ chave, nomeOriginal: "arte.pdf" }),
      enviarLocal(lerFixture("template-google")),
      arquivo(ID),
      teste(ID),
      teste(ID, "?baixar=1"),
    ]);
    for (const resposta of respostas) {
      expect(resposta.status).toBe(401);
      expect(await resposta.text()).toBe("Não autorizado.");
      expect(resposta.headers.get("Content-Disposition")).toBeNull();
    }
    // Nada foi registrado, e o arquivo que estava no armazenamento nem foi lido ou apagado.
    expect((await listarTemplates(db)).length).toBe(antes);
    expect(await armazenamento.existe(chave)).toBe(true);
    await armazenamento.excluir(chave);
  }

  it("sem sessão", async () => {
    estado.cookie = undefined;
    await esperarRecusaEmTodasAsRotas();
  });

  it("com cookie inválido ou assinado com outro segredo", async () => {
    estado.cookie = "isto-nao-e-um-token";
    await esperarRecusaEmTodasAsRotas();
    const outroSegredo = new TextEncoder().encode("outro-segredo-qualquer-com-mais-de-32-caracteres");
    estado.cookie = await assinarTokenDeSessao("00000000-0000-4000-8000-000000000001", outroSegredo);
    await esperarRecusaEmTodasAsRotas();
  });

  it("com sessão de um usuário que não é (ou deixou de ser) administrador", async () => {
    // Token com assinatura válida, mas de alguém que não existe na tabela de administradores.
    estado.cookie = await assinarTokenDeSessao("11111111-1111-4111-8111-111111111111", SEGREDO);
    await esperarRecusaEmTodasAsRotas();
    expect(COOKIE_DE_SESSAO).toBe("sessao_admin");
  });
});

describe("token de envio direto (client upload)", () => {
  it("autoriza só PDF, até 25 MB, na pasta dos templates, sem sobrescrever e por pouco tempo", async () => {
    const resposta = await pedirToken();
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { type: string; clientToken: string };
    expect(corpo.type).toBe("blob.generate-client-token");

    const permissoes = getPayloadFromClientToken(corpo.clientToken);
    expect(permissoes.pathname).toBe("templates-impressao/template.pdf");
    expect(permissoes.allowedContentTypes).toEqual(["application/pdf"]);
    expect(permissoes.maximumSizeInBytes).toBe(25 * 1024 * 1024);
    expect(permissoes.addRandomSuffix).toBe(true);
    expect(permissoes.allowOverwrite).toBe(false);
    expect(permissoes.validUntil - Date.now()).toBeGreaterThan(8 * 60 * 1000);
    expect(permissoes.validUntil - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    // Não há aviso de "envio concluído": a validação é feita pela rota de confirmação.
    expect(permissoes.onUploadCompleted).toBeUndefined();
  });

  it("recusa outros caminhos, outros tipos de evento e corpo inválido", async () => {
    for (const caminho of ["templates-impressao/../segredo.pdf", "outra-pasta/template.pdf", "templates-impressao/arte.exe"]) {
      expect((await pedirToken(pedidoDeToken(caminho))).status).toBe(400);
    }
    const concluido = { type: "blob.upload-completed", payload: { blob: { pathname: "x" }, tokenPayload: null } };
    expect((await pedirToken(concluido)).status).toBe(400);
    expect((await pedirToken({})).status).toBe(400);
    const invalido = await tokenDeEnvio(
      new Request(`${BASE}/api/templates-impressao/upload`, { method: "POST", body: "não é json" }),
    );
    expect(invalido.status).toBe(400);
  });

  it("não existe fora do Vercel Blob", async () => {
    estado.modo = "local";
    const resposta = await pedirToken();
    expect(resposta.status).toBe(409);
  });
});

describe("confirmação do envio", () => {
  it("valida o arquivo que está no armazenamento e cria o rascunho", async () => {
    const chave = await enviarArquivo(armazenamento, lerFixture("template-google"));
    const resposta = await confirmar({ chave, nomeOriginal: "cartao_google.pdf" });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    const corpo = (await resposta.json()) as { id: string; descricao: string };
    expect(corpo.descricao).toBe("PDF válido · cartao_google.pdf · 1 página · 130,05 × 86,70 mm · paisagem");

    const template = await buscarTemplate(db, corpo.id);
    expect(template?.status).toBe("RASCUNHO");
    expect(template?.chaveDoArquivo).toBe(chave);
  });

  it("arquivo inválido: responde o motivo e apaga o arquivo do armazenamento", async () => {
    const casos = [
      ["duas-paginas", "O template deve possuir apenas uma página."],
      ["pagina-rotacionada", "Páginas rotacionadas ainda não são suportadas. Exporte o PDF sem rotação."],
      ["nao-e-pdf", "O arquivo enviado não é um PDF, apesar da extensão."],
    ] as const;
    for (const [fixture, mensagem] of casos) {
      const chave = await enviarArquivo(armazenamento, lerFixture(fixture));
      const resposta = await confirmar({ chave, nomeOriginal: "arte.pdf" });
      expect(resposta.status).toBe(422);
      expect(await resposta.json()).toEqual({ erro: mensagem });
      expect(await armazenamento.existe(chave)).toBe(false);
    }
  });

  it("o tipo gravado no armazenamento não engana a validação", async () => {
    // Um texto enviado "como PDF": o Content-Type informado pelo navegador não é levado em conta.
    const chave = "templates-impressao/falso-pdf.pdf";
    await armazenamento.salvar(chave, new TextEncoder().encode("<html>oi</html>"), "application/pdf");
    expect(armazenamento.tipoDeConteudo(chave)).toBe("application/pdf");
    const resposta = await confirmar({ chave, nomeOriginal: "arte.pdf" });
    expect(resposta.status).toBe(422);
    expect(await armazenamento.existe(chave)).toBe(false);
  });

  it("recusa referência fora da pasta dos templates, arquivo inexistente e corpo inválido", async () => {
    expect((await confirmar({ chave: "../../etc/passwd", nomeOriginal: "a.pdf" })).status).toBe(422);
    expect((await confirmar({ chave: "templates-impressao/nao-existe.pdf", nomeOriginal: "a.pdf" })).status).toBe(422);
    expect((await confirmar({ chave: 123 })).status).toBe(400);
    expect((await confirmar({ chave: "templates-impressao/a.pdf", nomeOriginal: "a.pdf", templateId: "xyz" })).status).toBe(400);
  });
});

describe("envio local (somente desenvolvimento)", () => {
  it("responde 404 quando o armazenamento não é o local (como em toda implantação na Vercel)", async () => {
    estado.modo = "vercel-blob";
    const antes = armazenamento.chaves().length;
    expect((await enviarLocal(lerFixture("template-google"))).status).toBe(404);
    expect(armazenamento.chaves()).toHaveLength(antes);
  });

  it("no modo local grava o arquivo e devolve a chave; acima de 25 MB responde 413", async () => {
    estado.modo = "local";
    const resposta = await enviarLocal(lerFixture("template-google"));
    expect(resposta.status).toBe(200);
    const { chave } = (await resposta.json()) as { chave: string };
    expect(chave).toMatch(/^templates-impressao\/[0-9a-f-]{36}\.pdf$/);
    expect(await armazenamento.ler(chave)).toEqual(lerFixture("template-google"));
    await armazenamento.excluir(chave);

    const antes = armazenamento.chaves().length;
    const grande = await enviarLocal(new Uint8Array(25 * 1024 * 1024 + 1));
    expect(grande.status).toBe(413);
    expect(armazenamento.chaves()).toHaveLength(antes);
  });
});

describe("arquivos do template e de produção", () => {
  it("PDF original: os mesmos bytes enviados, em fluxo, só para o administrador", async () => {
    // Arte de 6 MB: maior que o limite de 4,5 MB de uma resposta montada de uma vez na Vercel.
    const pesado = criarPdfDeTemplate({ pesoExtraBytes: 6 * 1024 * 1024 }).bytes;
    const template = await criarTemplatePronto(db, armazenamento, { nome: "Google — Pesado", bytes: pesado });

    const resposta = await arquivo(template.id);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Type")).toBe("application/pdf");
    expect(resposta.headers.get("Content-Disposition")).toBe('inline; filename="template-google-pesado.pdf"');
    expect(resposta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(resposta.headers.get("Content-Length")).toBe(String(pesado.length));
    expect(resposta.body).toBeInstanceOf(ReadableStream);

    // O corpo sai em vários pedaços pequenos, não em um bloco só.
    const leitor = resposta.body!.getReader();
    const pedacos: Uint8Array[] = [];
    for (let leitura = await leitor.read(); !leitura.done; leitura = await leitor.read()) pedacos.push(leitura.value);
    expect(pedacos.length).toBeGreaterThan(10);
    expect(Math.max(...pedacos.map((pedaco) => pedaco.length))).toBeLessThanOrEqual(256 * 1024);
    expect(Buffer.concat(pedacos).equals(Buffer.from(pesado))).toBe(true);

    expect((await arquivo("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await arquivo("<script>")).status).toBe(404);
  });

  it("PDF de teste: nome teste-template-<produto>-<slug>.pdf e QR da URL reservada", async () => {
    const template = await criarTemplatePronto(db, armazenamento, { nome: "Google — Modelo 07" });
    const inline = await teste(template.id);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("Content-Disposition")).toBe('inline; filename="teste-template-google-google-modelo-07.pdf"');

    const baixado = await teste(template.id, "?baixar=1");
    expect(baixado.headers.get("Content-Disposition")).toBe(
      'attachment; filename="teste-template-google-google-modelo-07.pdf"',
    );
    const pdf = new Uint8Array(await baixado.arrayBuffer());
    expect((await lerQrDaPagina(pdf))?.conteudo).toBe("https://go.example.com/c/TESTE0");
    expect((await teste("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("lote com template: PDF, CSV e ZIP com os nomes novos; cartão com <produto>-<CODIGO>.pdf", async () => {
    const template = await criarTemplatePronto(db, armazenamento, { nome: "Instagram — Modelo 01", tipo: "INSTAGRAM" });
    const codigos = ["K8M4T2", "7PN3RX", "H4W9QD"];
    const { lote } = await criarLote(
      db,
      { quantidade: 3, tipo: "INSTAGRAM", descricao: null, templateId: template.id },
      { gerarCodigo: () => codigos.shift() ?? "ZZZZZ9" },
    );
    const nome = `lote-instagram-${lote.ano}-${String(lote.sequencia).padStart(3, "0")}`;

    const pdf = await doLote(lote.identificador, "?arquivo=pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Disposition")).toBe(`attachment; filename="${nome}.pdf"`);
    expect(await contarPaginas(new Uint8Array(await pdf.arrayBuffer()))).toBe(3);

    const csv = await doLote(lote.identificador, "?arquivo=csv");
    expect(csv.headers.get("Content-Disposition")).toBe(`attachment; filename="${nome}-controle.csv"`);
    const linhas = (await csv.text()).trimEnd().split("\r\n");
    expect(linhas[0]).toBe("numero,codigo,tipo,template,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr");
    expect(linhas).toContain(
      "2,H4W9QD,INSTAGRAM,Instagram — Modelo 01,https://go.example.com/c/H4W9QD,https://go.example.com/c/H4W9QD,https://go.example.com/c/H4W9QD,instagram-H4W9QD.pdf,H4W9QD.svg",
    );

    // O modelo e a parte do caminho antigo não se aplicam a lotes com template.
    const zip = await doLote(lote.identificador, "?modelo=google&parte=7");
    expect(zip.status).toBe(200);
    expect(zip.headers.get("Content-Disposition")).toBe(`attachment; filename="${nome}.zip"`);
    const arquivos = Object.keys((await JSZip.loadAsync(await zip.arrayBuffer())).files);
    expect(arquivos).toContain(`${nome}/${nome}.pdf`);
    expect(arquivos).toContain(`${nome}/individuais/instagram-K8M4T2.pdf`);

    const cartao = await doCartao("K8M4T2", "?modelo=google");
    expect(cartao.status).toBe(200);
    expect(cartao.headers.get("Content-Disposition")).toBe('attachment; filename="instagram-K8M4T2.pdf"');
    expect((await lerQrDaPagina(new Uint8Array(await cartao.arrayBuffer())))?.conteudo).toBe(
      "https://go.example.com/c/K8M4T2",
    );
    expect((await doCartao("K8M4T2", "?ver=1")).headers.get("Content-Disposition")).toBe(
      'inline; filename="instagram-K8M4T2.pdf"',
    );
  });

  it("se o arquivo do template sumir do armazenamento, a geração falha com mensagem clara", async () => {
    const template = await criarTemplatePronto(db, armazenamento, { nome: "Google — Vai sumir" });
    const { lote } = await criarLote(db, { quantidade: 1, tipo: "GOOGLE", descricao: null, templateId: template.id });
    await armazenamento.excluir(template.chaveDoArquivo);
    const resposta = await doLote(lote.identificador, "?arquivo=pdf");
    expect(resposta.status).toBe(422);
    expect(await resposta.text()).toContain("não está mais no armazenamento");
    // O CSV não depende do arquivo da arte.
    expect((await doLote(lote.identificador, "?arquivo=csv")).status).toBe(200);
  });
});
