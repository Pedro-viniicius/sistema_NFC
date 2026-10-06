// Arte de impressão de um cartão: GET /admin/cartoes/[codigo]/impressao?modelo=google|instagram&ver=1
import { obterBanco } from "@/db/cliente";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { gerarArteDoCartao } from "@/modules/printing/servico";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ codigo: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  const parametros = new URL(requisicao.url).searchParams;
  try {
    const { codigo } = await contexto.params;
    const arte = await gerarArteDoCartao(obterBanco(), codigo, parametros.get("modelo"));
    return respostaDeDownload(
      new Uint8Array(arte.pdf),
      "pdf",
      arte.nomeDoArquivo,
      parametros.has("ver") ? "inline" : "attachment",
    );
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
