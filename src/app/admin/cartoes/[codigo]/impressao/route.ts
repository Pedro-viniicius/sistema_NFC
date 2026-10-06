// Arte de impressão de um cartão: GET /admin/cartoes/[codigo]/impressao?modelo=google|instagram&ver=1
// Cartões de lotes gerados com template usam o template do lote (o parâmetro `modelo` é ignorado).
import { obterBanco } from "@/db/cliente";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { gerarArquivoDeImpressaoDoCartao } from "@/modules/printing/servico";
import { obterArmazenamento } from "@/modules/storage";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ codigo: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  const parametros = new URL(requisicao.url).searchParams;
  try {
    const { codigo } = await contexto.params;
    const arte = await gerarArquivoDeImpressaoDoCartao(
      obterBanco(),
      codigo,
      parametros.get("modelo"),
      obterArmazenamento,
    );
    return respostaDeDownload(
      arte.pdf,
      "pdf",
      arte.nomeDoArquivo,
      parametros.has("ver") ? "inline" : "attachment",
    );
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
