// QR Code do cartão: GET /admin/cartoes/[codigo]/qr?formato=svg|png&baixar=1
import { obterBanco } from "@/db/cliente";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { gerarQrPng, gerarQrSvg, nomeDoArquivoQr } from "@/modules/qr/gerar";

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ codigo: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  const codigo = normalizarCodigo((await contexto.params).codigo);
  const cartao = codigo ? await buscarCartaoPorCodigo(obterBanco(), codigo) : null;
  if (!cartao) return new Response("Cartão não encontrado.", { status: 404 });

  const parametros = new URL(requisicao.url).searchParams;
  const formato = parametros.get("formato") === "png" ? "png" : "svg";
  const disposicao = parametros.has("baixar") ? "attachment" : "inline";

  // O QR é gerado a partir do código: o conteúdo é sempre a URL permanente, nunca o destino.
  const corpo: BodyInit =
    formato === "png" ? new Uint8Array(await gerarQrPng(cartao.codigo)) : await gerarQrSvg(cartao.codigo);

  return new Response(corpo, {
    headers: {
      "Content-Type": formato === "png" ? "image/png" : "image/svg+xml; charset=utf-8",
      "Content-Disposition": `${disposicao}; filename="${nomeDoArquivoQr(cartao.codigo, formato)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
