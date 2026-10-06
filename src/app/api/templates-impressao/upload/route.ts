// Envio direto do navegador para o Vercel Blob (client upload): POST /api/templates-impressao/upload
//
// O PDF NÃO passa por esta rota. Funções da Vercel aceitam corpos de até 4,5 MB, e um template pode
// ter 25 MB. Esta rota só emite, para um administrador autenticado, um token de curta duração que
// autoriza UM envio: só PDF, só na pasta dos templates, até o tamanho máximo, sem sobrescrever nada.
//
// A validação do arquivo acontece depois, em /api/templates-impressao/confirmar. Não usamos o
// aviso `onUploadCompleted` do Blob para isso: ele não é entregue em localhost.
//
// Fica em /api (fora de /admin) de propósito: as rotas de envio não passam pelo proxy do painel,
// que limita o corpo das requisições. A autorização é conferida aqui mesmo.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { obterAdminAtual } from "@/modules/auth/sessao";
import { modoDeArmazenamento } from "@/modules/storage";
import { PASTA_DOS_TEMPLATES, TIPO_DE_CONTEUDO_DO_TEMPLATE } from "@/modules/templates/servico";
import { MAX_TEMPLATE_BYTES } from "@/modules/templates/validacao-do-pdf";

export const runtime = "nodejs";

/** O navegador sempre pede este caminho; o Blob acrescenta um sufixo aleatório ao nome. */
const CAMINHO_DE_ENVIO = `${PASTA_DOS_TEMPLATES}/template.pdf`;
const VALIDADE_DO_TOKEN_EM_MS = 10 * 60 * 1000;

function recusa(status: number, erro: string): Response {
  return Response.json({ erro }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(requisicao: Request): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  let corpo: HandleUploadBody;
  try {
    corpo = (await requisicao.json()) as HandleUploadBody;
  } catch {
    return recusa(400, "Requisição inválida.");
  }
  // Só a emissão de token é atendida. Avisos de "envio concluído" não são usados nem aceitos.
  if (corpo?.type !== "blob.generate-client-token") return recusa(400, "Requisição inválida.");

  try {
    if (modoDeArmazenamento() !== "vercel-blob") {
      return recusa(409, "O envio direto para o Vercel Blob não está disponível neste ambiente.");
    }
    const resposta = await handleUpload({
      body: corpo,
      request: requisicao,
      onBeforeGenerateToken: async (caminho) => {
        // A sessão é conferida de novo no momento de emitir o token.
        if (!(await obterAdminAtual())) throw new Error("Não autorizado.");
        if (caminho !== CAMINHO_DE_ENVIO) throw new Error("Caminho de envio inválido.");
        return {
          allowedContentTypes: [TIPO_DE_CONTEUDO_DO_TEMPLATE],
          maximumSizeInBytes: MAX_TEMPLATE_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + VALIDADE_DO_TOKEN_EM_MS,
        };
      },
    });
    registrarLog("info", "templates.token_de_envio_emitido", { adminId: admin.id });
    return Response.json(resposta, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    registrarLog("erro", "templates.falha_ao_emitir_token", { mensagem: mensagemDoErro(erro) });
    return recusa(400, "Não foi possível autorizar o envio do arquivo.");
  }
}
