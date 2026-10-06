// Amostra da arte de um modelo: GET /admin/artes/[slug]/amostra
// Gera um cartão fictício com a arte que está valendo (enviada ou padrão), para conferência visual.
import { obterBanco } from "@/db/cliente";
import { ErroDeDominio } from "@/lib/erros";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { CODIGO_DE_AMOSTRA, obterModeloEfetivo } from "@/modules/printing/artes";
import { obterModeloPorSlug } from "@/modules/printing/modelos";
import { gerarPdfDoCartao } from "@/modules/printing/pdf";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  try {
    const base = obterModeloPorSlug((await contexto.params).slug);
    if (!base) throw new ErroDeDominio("MODELO_NAO_ENCONTRADO", "Modelo de impressão desconhecido.");
    const modelo = await obterModeloEfetivo(obterBanco(), base);
    const pdf = await gerarPdfDoCartao(CODIGO_DE_AMOSTRA, modelo);
    return respostaDeDownload(new Uint8Array(pdf), "pdf", `amostra-${modelo.slug}.pdf`, "inline");
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
