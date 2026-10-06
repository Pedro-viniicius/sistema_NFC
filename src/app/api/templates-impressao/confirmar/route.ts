// Confirmação do envio: POST /api/templates-impressao/confirmar
//
// Chamada pelo navegador logo depois de o PDF chegar ao armazenamento. O servidor então:
//   1. baixa o arquivo do armazenamento;
//   2. faz a validação completa (é um PDF de verdade? uma página? sem senha, rotação ou scripts?);
//   3. cria o RASCUNHO do template (ou troca a arte de um rascunho existente).
// Se o arquivo não servir, ele é apagado do armazenamento e o motivo volta na resposta.
import { z } from "zod";
import { obterBanco } from "@/db/cliente";
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { obterArmazenamento } from "@/modules/storage";
import { registrarTemplateEnviado, substituirArquivoDoTemplate } from "@/modules/templates/servico";
import { descreverPdfDoTemplate } from "@/modules/templates/validacao-do-pdf";

export const runtime = "nodejs";
// Baixar e validar um PDF de 25 MB leva poucos segundos; o teto dá folga para uma rede lenta.
export const maxDuration = 60;

const esquema = z.object({
  chave: z.string().max(300),
  nomeOriginal: z.string().max(500),
  /** Presente quando o envio troca a arte de um rascunho existente. */
  templateId: z.uuid().optional(),
});

function resposta(status: number, corpo: Record<string, unknown>): Response {
  return Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(requisicao: Request): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  let entrada: z.infer<typeof esquema>;
  try {
    entrada = esquema.parse(await requisicao.json());
  } catch {
    return resposta(400, { erro: "Requisição inválida." });
  }

  try {
    const db = obterBanco();
    const armazenamento = obterArmazenamento();
    const envio = { chave: entrada.chave, nomeOriginal: entrada.nomeOriginal };
    const template = entrada.templateId
      ? await substituirArquivoDoTemplate(db, armazenamento, entrada.templateId, envio)
      : await registrarTemplateEnviado(db, armazenamento, envio);

    registrarLog("info", entrada.templateId ? "templates.arquivo_trocado" : "templates.rascunho_criado", {
      templateId: template.id,
      bytes: template.tamanhoBytes,
      sha256: template.sha256,
      adminId: admin.id,
    });
    return resposta(200, { id: template.id, descricao: `PDF válido · ${descreverPdfDoTemplate(template)}` });
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      registrarLog("aviso", "templates.envio_recusado", { motivo: erro.message, adminId: admin.id });
      return resposta(erro.codigo === "TEMPLATE_NAO_ENCONTRADO" ? 404 : 422, { erro: erro.message });
    }
    if (erro instanceof ErroDeConfiguracao) {
      registrarLog("erro", "templates.armazenamento_nao_configurado", { mensagem: erro.message });
      return resposta(500, { erro: erro.message });
    }
    registrarLog("erro", "templates.falha_ao_confirmar_envio", { mensagem: mensagemDoErro(erro) });
    return resposta(500, { erro: "Não foi possível processar o arquivo. Tente novamente." });
  }
}
