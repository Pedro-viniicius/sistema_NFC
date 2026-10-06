// Cenário de validação final do produto, de ponta a ponta:
// o cartão físico (código, URL permanente, QR e NFC) nunca muda; só o destino no banco muda.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Banco } from "@/db/tipos";
import { resumirCartao } from "@/modules/cards/apresentacao";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { configurarDestino, criarCartaoComCodigo } from "@/modules/cards/servico";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { conteudoDoQr, gerarQrPng, gerarQrSvg } from "@/modules/qr/gerar";
import { criarBancoDeTeste } from "./banco-de-teste";
import { lerQrDoPng } from "./ler-qr";

const estado = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/cliente", () => ({ obterBanco: () => estado.db }));
vi.mock("next/server", () => ({ after: () => {} }));

import { GET } from "@/app/c/[codigo]/route";

const CODIGO = "K8M4T2";
const URL_PERMANENTE = "https://go.example.com/c/K8M4T2";

let db: Banco;

beforeAll(async () => {
  db = await criarBancoDeTeste();
  estado.db = db;
});

/** Simula a leitura do cartão (QR ou NFC): os dois abrem exatamente a mesma URL. */
async function aproximarCartao(urlGravadaNoCartao: string): Promise<Response> {
  const codigo = new URL(urlGravadaNoCartao).pathname.split("/").pop() ?? "";
  return GET(new Request(urlGravadaNoCartao), { params: Promise.resolve({ codigo }) });
}

async function fotografarCartaoFisico() {
  const cartao = await buscarCartaoPorCodigo(db, CODIGO);
  if (!cartao) throw new Error("cartão não encontrado");
  return {
    id: cartao.id,
    codigo: cartao.codigo,
    urlPermanente: getCardPublicUrl(cartao.codigo),
    urlDoNfc: resumirCartao(cartao).urlPermanente,
    conteudoDoQr: conteudoDoQr(cartao.codigo),
    qrLido: lerQrDoPng(await gerarQrPng(cartao.codigo)),
    qrSvg: await gerarQrSvg(cartao.codigo),
  };
}

describe("cenário final: um cartão físico, destinos que mudam", () => {
  it("mudar o destino não muda código, URL permanente, QR Code nem URL do NFC", async () => {
    // 1. Gera o cartão K8M4T2
    await criarCartaoComCodigo(db, CODIGO);

    // 2-4. URL permanente, conteúdo do QR e URL do NFC são a mesma coisa
    const antes = await fotografarCartaoFisico();
    expect(antes.urlPermanente).toBe(URL_PERMANENTE);
    expect(antes.conteudoDoQr).toBe(URL_PERMANENTE);
    expect(antes.qrLido).toBe(URL_PERMANENTE);
    expect(antes.urlDoNfc).toBe(URL_PERMANENTE);

    // 5-6. Configura o Instagram da Empresa A e acessa a URL permanente
    await configurarDestino(db, {
      codigo: CODIGO,
      tipo: "INSTAGRAM",
      destinoUrl: "https://instagram.com/empresaA",
    });
    const primeira = await aproximarCartao(antes.qrLido ?? "");
    expect(primeira.status).toBe(302);
    expect(primeira.headers.get("Location")).toBe("https://instagram.com/empresaA");

    // 7-9. Troca o destino para o Google e acessa a MESMA URL de novo
    await configurarDestino(db, {
      codigo: CODIGO,
      tipo: "GOOGLE",
      destinoUrl: "https://g.page/r/example/review",
    });
    const segunda = await aproximarCartao(antes.urlDoNfc);
    expect(segunda.status).toBe(302);
    expect(segunda.headers.get("Location")).toBe("https://g.page/r/example/review");

    // 10. Nada do cartão físico mudou: só o destino no banco
    const depois = await fotografarCartaoFisico();
    expect(depois).toEqual(antes);
    expect(depois.codigo).toBe(CODIGO);
    expect((await buscarCartaoPorCodigo(db, CODIGO))?.destinoUrl).toBe("https://g.page/r/example/review");
  });
});
