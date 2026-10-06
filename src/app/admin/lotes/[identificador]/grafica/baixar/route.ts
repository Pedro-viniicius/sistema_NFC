// Arquivos de produção do lote:
// GET /admin/lotes/[identificador]/grafica/baixar?arquivo=pdf|csv|zip&modelo=google|instagram&parte=1
//
// Lotes gerados com um template de impressão usam SEMPRE o template do lote (`modelo` e `parte` não
// se aplicam). Os demais seguem pelo caminho anterior, inalterado.
import type { TemplateDeImpressao } from "@/db/schema";
import { obterBanco } from "@/db/cliente";
import { registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import {
  NOME_DO_CSV_DE_CONTROLE,
  gerarCsvDeControle,
  gerarPdfDoPacote,
  gerarZipDoPacote,
} from "@/modules/printing/producao";
import {
  carregarLoteParaProducao,
  planejarPacoteDoLote,
  resolverModeloDoLote,
  type LoteParaProducao,
} from "@/modules/printing/servico";
import { obterArmazenamento } from "@/modules/storage";
import {
  buscarTemplateDoLote,
  carregarArquivoDoLote,
  gerarCsvDeControleComTemplate,
  gerarPdfDoPacoteComTemplate,
  gerarZipComTemplate,
  planejarPacoteComTemplate,
} from "@/modules/templates/producao";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

const ARQUIVOS = ["pdf", "csv", "zip"] as const;
type Arquivo = (typeof ARQUIVOS)[number];

export const runtime = "nodejs";
// Gerar é rápido (1.000 cartões com um template de 25 MB em cerca de 1 s). O que demora é o
// download do pacote com os PDFs individuais, que pode ter centenas de MB: a função fica aberta
// enquanto o navegador baixa.
export const maxDuration = 300;

function arquivoPedido(valor: string | null): Arquivo {
  return ARQUIVOS.find((arquivo) => arquivo === valor) ?? "zip";
}

async function baixarComTemplate(
  { lote, cartoes }: LoteParaProducao,
  template: TemplateDeImpressao,
  arquivo: Arquivo,
  adminId: string,
): Promise<Response> {
  // O plano valida tudo antes de qualquer arquivo ser gerado.
  const pacote = planejarPacoteComTemplate(
    lote,
    cartoes.map((cartao) => cartao.codigo),
    template,
  );
  registrarLog("info", "impressao.arquivo_gerado", {
    pacote: pacote.nome,
    arquivo,
    cartoes: pacote.itens.length,
    templateId: template.id,
    adminId,
  });

  if (arquivo === "csv") {
    return respostaDeDownload(gerarCsvDeControleComTemplate(pacote), "csv", `${pacote.nome}-${NOME_DO_CSV_DE_CONTROLE}`);
  }
  // O arquivo do template é lido do armazenamento uma única vez por requisição.
  const arte = await carregarArquivoDoLote(obterArmazenamento(), lote, template);
  return arquivo === "pdf"
    ? respostaDeDownload(await gerarPdfDoPacoteComTemplate(pacote, arte), "pdf", `${pacote.nome}.pdf`)
    : respostaDeDownload(await gerarZipComTemplate(pacote, arte), "zip", `${pacote.nome}.zip`);
}

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ identificador: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  const parametros = new URL(requisicao.url).searchParams;
  const arquivo = arquivoPedido(parametros.get("arquivo"));
  const parte = parametros.has("parte") ? Number(parametros.get("parte")) : undefined;

  try {
    const { identificador } = await contexto.params;
    const db = obterBanco();
    const lote = await carregarLoteParaProducao(db, identificador);
    const template = await buscarTemplateDoLote(db, lote.lote);
    if (template) return await baixarComTemplate(lote, template, arquivo, admin.id);

    const modelo = await resolverModeloDoLote(db, lote.lote, parametros.get("modelo"));
    // O plano valida tudo antes de qualquer arquivo ser gerado.
    const pacote = await planejarPacoteDoLote(lote, modelo, parte);

    registrarLog("info", "impressao.arquivo_gerado", {
      pacote: pacote.nome,
      arquivo,
      cartoes: pacote.itens.length,
      adminId: admin.id,
    });

    switch (arquivo) {
      case "pdf":
        return respostaDeDownload(new Uint8Array(await gerarPdfDoPacote(pacote)), "pdf", `${pacote.nome}.pdf`);
      case "csv":
        return respostaDeDownload(
          gerarCsvDeControle(pacote),
          "csv",
          `${pacote.nome}-${NOME_DO_CSV_DE_CONTROLE}`,
        );
      case "zip":
        return respostaDeDownload(await gerarZipDoPacote(pacote), "zip", `${pacote.nome}.zip`);
    }
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
