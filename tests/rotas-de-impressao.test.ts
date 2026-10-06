// Rotas de download de produção: só administradores autenticados geram arquivos,
// e as respostas saem com os cabeçalhos corretos.
import JSZip from "jszip";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Banco } from "@/db/tipos";
import { criarLote } from "@/modules/batches/servico";
import { configurarDestino, criarCartaoComCodigo } from "@/modules/cards/servico";
import { criarBancoDeTeste } from "./banco-de-teste";
import { lerPdfDeImpressao } from "./ler-pdf";
import { lerQrDoSvg } from "./ler-qr";

const estado = vi.hoisted(() => ({
  db: undefined as unknown,
  admin: null as { id: string; email: string } | null,
}));

vi.mock("@/db/cliente", () => ({ obterBanco: () => estado.db }));
// Substitui apenas a leitura da sessão (cookie); a checagem de autorização das rotas é a real.
vi.mock("@/modules/auth/sessao", () => ({ obterAdminAtual: async () => estado.admin }));

import { GET as baixarArteDoCartao } from "@/app/admin/cartoes/[codigo]/impressao/route";
import { GET as baixarQrDoCartao } from "@/app/admin/cartoes/[codigo]/qr/route";
import { GET as exportarLote } from "@/app/admin/lotes/[identificador]/exportar/route";
import { GET as baixarDoLote } from "@/app/admin/lotes/[identificador]/grafica/baixar/route";

const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";
let db: Banco;
let loteGoogle: string;
let loteSemTipo: string;

function arte(codigo: string, consulta = ""): Promise<Response> {
  return baixarArteDoCartao(new Request(`https://go.example.com/admin/cartoes/${codigo}/impressao${consulta}`), {
    params: Promise.resolve({ codigo }),
  });
}

function qr(codigo: string, consulta = ""): Promise<Response> {
  return baixarQrDoCartao(new Request(`https://go.example.com/admin/cartoes/${codigo}/qr${consulta}`), {
    params: Promise.resolve({ codigo }),
  });
}

function doLote(identificador: string, consulta = ""): Promise<Response> {
  return baixarDoLote(
    new Request(`https://go.example.com/admin/lotes/${identificador}/grafica/baixar${consulta}`),
    { params: Promise.resolve({ identificador }) },
  );
}

beforeAll(async () => {
  db = await criarBancoDeTeste();
  estado.db = db;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  await criarCartaoComCodigo(db, "K8M4T2", { tipo: "GOOGLE" });
  await configurarDestino(db, {
    codigo: "K8M4T2",
    tipo: "GOOGLE",
    destinoUrl: "https://g.page/r/customer/review",
  });
  await criarCartaoComCodigo(db, "SEMTP2");
  loteGoogle = (await criarLote(db, { quantidade: 4, tipo: "GOOGLE", descricao: null })).lote.identificador;
  loteSemTipo = (await criarLote(db, { quantidade: 2, tipo: null, descricao: null })).lote.identificador;
});

beforeEach(() => {
  estado.admin = { id: "admin-1", email: "admin@exemplo.com.br" };
});

describe("sem sessão de administrador", () => {
  beforeEach(() => {
    estado.admin = null;
  });

  it("nenhum arquivo de produção é gerado (401)", async () => {
    const respostas = await Promise.all([
      arte("K8M4T2"),
      arte("K8M4T2", "?modelo=google&ver=1"),
      qr("K8M4T2"),
      doLote(loteGoogle, "?arquivo=pdf"),
      doLote(loteGoogle, "?arquivo=csv"),
      doLote(loteGoogle, "?arquivo=zip"),
      exportarLote(new Request(`https://go.example.com/admin/lotes/${loteGoogle}/exportar`), {
        params: Promise.resolve({ identificador: loteGoogle }),
      }),
    ]);
    for (const resposta of respostas) {
      expect(resposta.status).toBe(401);
      expect(resposta.headers.get("Content-Disposition")).toBeNull();
      expect(await resposta.text()).toBe("Não autorizado.");
    }
  });

  it("não revela se o cartão ou o lote existem", async () => {
    expect((await arte("ZZZZZ9")).status).toBe(401);
    expect((await doLote("lote-1999-001")).status).toBe(401);
  });
});

describe("arte individual do cartão", () => {
  it("devolve o PDF com cabeçalhos de download e o QR da URL permanente", async () => {
    const resposta = await arte("K8M4T2");
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Type")).toBe("application/pdf");
    expect(resposta.headers.get("Content-Disposition")).toBe('attachment; filename="google-K8M4T2.pdf"');
    expect(resposta.headers.get("Cache-Control")).toBe("private, no-store");

    const pdf = new Uint8Array(await resposta.arrayBuffer());
    const [pagina] = await lerPdfDeImpressao(pdf);
    expect(pagina.conteudoDoQr).toBe(URL_PERMANENTE);
    expect(Buffer.from(pdf).toString("latin1")).not.toContain("g.page");
  });

  it("permite escolher o modelo e abrir no navegador", async () => {
    const resposta = await arte("k8m4t2", "?modelo=instagram&ver=1");
    expect(resposta.headers.get("Content-Disposition")).toBe('inline; filename="instagram-K8M4T2.pdf"');
  });

  it("explica quando falta o modelo, e recusa modelo desconhecido e cartão inexistente", async () => {
    const semModelo = await arte("SEMTP2");
    expect(semModelo.status).toBe(422);
    expect(await semModelo.text()).toContain("Escolha o modelo");
    expect((await arte("SEMTP2", "?modelo=google")).status).toBe(200);
    expect((await arte("K8M4T2", "?modelo=tiktok")).status).toBe(422);
    expect((await arte("ZZZZZ9")).status).toBe(404);
    expect((await arte("<script>")).status).toBe(404);
  });
});

describe("QR avulso em SVG", () => {
  it("devolve image/svg+xml com a URL permanente", async () => {
    const resposta = await qr("K8M4T2", "?formato=svg&baixar=1");
    expect(resposta.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(resposta.headers.get("Content-Disposition")).toBe('attachment; filename="qr-K8M4T2.svg"');
    expect(lerQrDoSvg(await resposta.text())).toBe(URL_PERMANENTE);
  });
});

describe("arquivos de produção do lote", () => {
  it("PDF do lote: uma página por cartão", async () => {
    const resposta = await doLote(loteGoogle, "?arquivo=pdf");
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Type")).toBe("application/pdf");
    expect(resposta.headers.get("Content-Disposition")).toBe(`attachment; filename="${loteGoogle}-google.pdf"`);
    expect(await lerPdfDeImpressao(await resposta.arrayBuffer())).toHaveLength(4);
  });

  it("CSV de controle em UTF-8", async () => {
    const resposta = await doLote(loteGoogle, "?arquivo=csv");
    expect(resposta.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(resposta.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${loteGoogle}-google-controle.csv"`,
    );
    const linhas = (await resposta.text()).trimEnd().split("\r\n");
    expect(linhas[0]).toBe("numero,codigo,tipo,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr");
    expect(linhas).toHaveLength(5);
  });

  it("ZIP completo (padrão quando o arquivo não é informado)", async () => {
    const resposta = await doLote(loteGoogle);
    expect(resposta.headers.get("Content-Type")).toBe("application/zip");
    expect(resposta.headers.get("Content-Disposition")).toBe(`attachment; filename="${loteGoogle}-google.zip"`);
    const zip = await JSZip.loadAsync(await resposta.arrayBuffer());
    const nomes = Object.values(zip.files).filter((arquivo) => !arquivo.dir).map((arquivo) => arquivo.name);
    expect(nomes).toHaveLength(3 + 4 + 4);
    expect(nomes.every((nome) => nome.startsWith(`${loteGoogle}-google/`))).toBe(true);
  });

  it("lote sem tipo exige a escolha do modelo", async () => {
    const semModelo = await doLote(loteSemTipo, "?arquivo=pdf");
    expect(semModelo.status).toBe(422);
    expect(await semModelo.text()).toContain("Escolha o modelo");

    const comModelo = await doLote(loteSemTipo, "?arquivo=pdf&modelo=instagram");
    expect(comModelo.status).toBe(200);
    expect(comModelo.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${loteSemTipo}-instagram.pdf"`,
    );
  });

  it("recusa parte inexistente, modelo desconhecido e lote inexistente, sem gerar nada", async () => {
    const parteInvalida = await doLote(loteGoogle, "?arquivo=zip&parte=2");
    expect(parteInvalida.status).toBe(422);
    expect(parteInvalida.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect((await doLote(loteGoogle, "?parte=abc")).status).toBe(422);
    expect((await doLote(loteGoogle, "?modelo=tiktok")).status).toBe(422);
    expect((await doLote("lote-1999-001")).status).toBe(404);
    expect((await doLote("../../etc/passwd")).status).toBe(404);
  });
});
