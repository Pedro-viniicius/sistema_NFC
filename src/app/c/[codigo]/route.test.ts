import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cartoes } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { configurarDestino, criarCartaoComCodigo, desativarCartao } from "@/modules/cards/servico";
import { criarBancoDeTeste } from "../../../../tests/banco-de-teste";

const estado = vi.hoisted(() => ({
  db: undefined as unknown,
  falharBanco: false,
  pendentes: [] as Array<() => Promise<void>>,
}));

vi.mock("@/db/cliente", () => ({
  obterBanco: () => {
    if (estado.falharBanco) throw new Error("conexão recusada");
    return estado.db;
  },
}));

// Fora do Next não existe "depois da resposta": guardamos as tarefas para executar no teste.
vi.mock("next/server", () => ({
  after: (tarefa: () => Promise<void>) => {
    estado.pendentes.push(tarefa);
  },
}));

import { GET, HEAD } from "./route";

let db: Banco;

function acessar(codigo: string, consulta = ""): Promise<Response> {
  const requisicao = new Request(`https://go.example.com/c/${encodeURIComponent(codigo)}${consulta}`);
  return GET(requisicao, { params: Promise.resolve({ codigo }) });
}

async function executarPendentes(): Promise<void> {
  for (const tarefa of estado.pendentes.splice(0)) await tarefa();
}

beforeAll(async () => {
  db = await criarBancoDeTeste();
  estado.db = db;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  estado.falharBanco = false;
  estado.pendentes.length = 0;
});

describe("GET /c/[codigo]", () => {
  it("cartão válido e configurado: redireciona imediatamente com 302", async () => {
    await criarCartaoComCodigo(db, "RED222");
    await configurarDestino(db, {
      codigo: "RED222",
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/empresa",
    });

    const resposta = await acessar("RED222");
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("Location")).toBe("https://instagram.com/empresa");
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    expect(await resposta.text()).toBe("");
  });

  it("aceita o código em minúsculas", async () => {
    const resposta = await acessar("red222");
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("Location")).toBe("https://instagram.com/empresa");
  });

  it("ignora destino vindo de parâmetro público: o destino vem sempre do banco", async () => {
    const resposta = await acessar(
      "RED222",
      "?redirect=https://malicioso.com&url=https://malicioso.com&destino=https://malicioso.com",
    );
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("Location")).toBe("https://instagram.com/empresa");
  });

  it("cartão não configurado: mostra página de configuração pendente, sem redirecionar", async () => {
    await criarCartaoComCodigo(db, "RED333");
    const resposta = await acessar("RED333");
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Location")).toBeNull();
    expect(resposta.headers.get("Content-Type")).toContain("text/html");
    expect(await resposta.text()).toContain("Cartão ainda não configurado");
  });

  it("cartão inativo: mostra página de indisponível, sem redirecionar", async () => {
    await criarCartaoComCodigo(db, "RED444");
    await configurarDestino(db, {
      codigo: "RED444",
      tipo: "GENERICO",
      destinoUrl: "https://empresa.com.br",
    });
    await desativarCartao(db, "RED444");

    const resposta = await acessar("RED444");
    expect(resposta.status).toBe(410);
    expect(resposta.headers.get("Location")).toBeNull();
    expect(await resposta.text()).toContain("Cartão indisponível");
  });

  it("código inexistente: responde 404", async () => {
    const resposta = await acessar("ZZZZZ9");
    expect(resposta.status).toBe(404);
    expect(resposta.headers.get("Location")).toBeNull();
    expect(await resposta.text()).toContain("Cartão não encontrado");
  });

  it.each(["000001", "abc", "K8M4T2X", "../admin", "<script>", "K8M4T0"])(
    "código inválido %s: responde 404 sem refletir a entrada",
    async (codigo) => {
      const resposta = await acessar(codigo);
      expect(resposta.status).toBe(404);
      expect(await resposta.text()).not.toContain(codigo);
    },
  );

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["http em produção", "http://empresa.com.br"],
  ])("destino salvo inválido (%s): não redireciona", async (_nome, destinoUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    const [cartao] = await db
      .insert(cartoes)
      .values({ codigo: "RED555", tipo: "GENERICO", destinoUrl, status: "ATIVO" })
      .onConflictDoUpdate({ target: cartoes.codigo, set: { destinoUrl } })
      .returning();
    expect(cartao.destinoUrl).toBe(destinoUrl);

    const resposta = await acessar("RED555");
    vi.unstubAllEnvs();
    expect(resposta.status).toBe(500);
    expect(resposta.headers.get("Location")).toBeNull();
    expect(await resposta.text()).not.toContain("alert");
  });

  it("falha de banco: responde 503 sem redirecionar", async () => {
    estado.falharBanco = true;
    const resposta = await acessar("RED222");
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("Location")).toBeNull();
  });
});

describe("estatística de acessos", () => {
  it("conta o acesso depois da resposta e registra a data do último", async () => {
    await criarCartaoComCodigo(db, "CNT222");
    await configurarDestino(db, { codigo: "CNT222", tipo: "GENERICO", destinoUrl: "https://a.com.br" });

    await acessar("CNT222");
    await acessar("CNT222");
    expect((await buscarCartaoPorCodigo(db, "CNT222"))?.totalAcessos).toBe(0);
    await executarPendentes();

    const cartao = await buscarCartaoPorCodigo(db, "CNT222");
    expect(cartao?.totalAcessos).toBe(2);
    expect(cartao?.ultimoAcessoEm).toBeInstanceOf(Date);
  });

  it("não conta acesso de cartão que não redireciona nem requisições HEAD", async () => {
    await criarCartaoComCodigo(db, "CNT333");
    await acessar("CNT333");
    const cabecalho = await HEAD(new Request("https://go.example.com/c/CNT222", { method: "HEAD" }), {
      params: Promise.resolve({ codigo: "CNT222" }),
    });
    expect(cabecalho.status).toBe(302);
    await executarPendentes();

    const [naoConfigurado] = await db.select().from(cartoes).where(eq(cartoes.codigo, "CNT333"));
    expect(naoConfigurado.totalAcessos).toBe(0);
    expect((await buscarCartaoPorCodigo(db, "CNT222"))?.totalAcessos).toBe(2);
  });
});
