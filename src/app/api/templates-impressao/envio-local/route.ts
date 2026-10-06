// Envio de template SOMENTE em desenvolvimento: PUT /api/templates-impressao/envio-local
//
// Na Vercel o PDF vai do navegador direto para o Blob. Na máquina do desenvolvedor, sem Blob,
// o arquivo é recebido aqui e gravado no disco local. Esta rota responde 404 sempre que o
// armazenamento não for o local — o que inclui toda implantação na Vercel.
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { modoDeArmazenamento, obterArmazenamento } from "@/modules/storage";
import { TIPO_DE_CONTEUDO_DO_TEMPLATE, gerarChaveDoTemplate } from "@/modules/templates/servico";
import { MAX_TEMPLATE_BYTES } from "@/modules/templates/validacao-do-pdf";

export const runtime = "nodejs";

function resposta(status: number, corpo: Record<string, unknown>): Response {
  return Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

function armazenamentoLocalAtivo(): boolean {
  try {
    return modoDeArmazenamento() === "local";
  } catch {
    return false;
  }
}

export async function PUT(requisicao: Request): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;
  if (!armazenamentoLocalAtivo()) return resposta(404, { erro: "Não encontrado." });

  // Lê o corpo aos poucos e para assim que passar do limite.
  const pedacos: Uint8Array[] = [];
  let total = 0;
  const leitor = requisicao.body?.getReader();
  if (!leitor) return resposta(400, { erro: "Nenhum arquivo recebido." });
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > MAX_TEMPLATE_BYTES) {
      await leitor.cancel();
      return resposta(413, { erro: `O arquivo é maior que ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB.` });
    }
    pedacos.push(value);
  }
  if (total === 0) return resposta(400, { erro: "Nenhum arquivo recebido." });

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.length;
  }

  const chave = gerarChaveDoTemplate();
  await obterArmazenamento().salvar(chave, bytes, TIPO_DE_CONTEUDO_DO_TEMPLATE);
  return resposta(200, { chave });
}
