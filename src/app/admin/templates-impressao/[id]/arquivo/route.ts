// PDF original do template, para a prévia no painel: GET /admin/templates-impressao/[id]/arquivo
// O arquivo é privado no armazenamento; só sai por aqui, para um administrador autenticado.
import { obterBanco } from "@/db/cliente";
import { ErroDeDominio } from "@/lib/erros";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { obterArmazenamento } from "@/modules/storage";
import { formatoDeArquivoDoTemplate } from "@/modules/templates/nomes";
import { buscarTemplate, carregarArquivoDoTemplate } from "@/modules/templates/servico";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  try {
    const template = await buscarTemplate(obterBanco(), (await contexto.params).id);
    if (!template) throw new ErroDeDominio("TEMPLATE_NAO_ENCONTRADO", "Template de impressão não encontrado.");
    const bytes = await carregarArquivoDoTemplate(obterArmazenamento(), template);
    const baixar = new URL(requisicao.url).searchParams.has("baixar");
    return respostaDeDownload(bytes, "pdf", formatoDeArquivoDoTemplate(template), baixar ? "attachment" : "inline");
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
