// PDF de teste do template: GET /admin/templates-impressao/[id]/teste[?baixar=1]
// É o PDF enviado mais o QR da URL reservada de teste. Não cria cartão nem altera o template.
import { obterBanco } from "@/db/cliente";
import { registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { obterArmazenamento } from "@/modules/storage";
import { gerarPdfDeTeste } from "@/modules/templates/servico";
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
    const { id } = await contexto.params;
    const teste = await gerarPdfDeTeste(obterBanco(), obterArmazenamento(), id);
    const baixar = new URL(requisicao.url).searchParams.has("baixar");
    if (baixar) registrarLog("info", "templates.pdf_de_teste_baixado", { templateId: id, adminId: admin.id });
    return respostaDeDownload(teste.pdf, "pdf", teste.nomeDoArquivo, baixar ? "attachment" : "inline");
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
