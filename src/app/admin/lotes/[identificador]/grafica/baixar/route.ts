// Arquivos de produção do lote:
// GET /admin/lotes/[identificador]/grafica/baixar?arquivo=pdf|csv|zip&modelo=google|instagram&parte=1
import { obterBanco } from "@/db/cliente";
import { registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import {
  NOME_DO_CSV_DE_CONTROLE,
  gerarCsvDeControle,
  gerarPdfDoPacote,
  gerarZipDoPacote,
} from "@/modules/printing/producao";
import { carregarLoteParaProducao, planejarPacoteDoLote } from "@/modules/printing/servico";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";

const ARQUIVOS = ["pdf", "csv", "zip"] as const;
type Arquivo = (typeof ARQUIVOS)[number];

function arquivoPedido(valor: string | null): Arquivo {
  return ARQUIVOS.find((arquivo) => arquivo === valor) ?? "zip";
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
    const lote = await carregarLoteParaProducao(obterBanco(), identificador);
    // O plano valida tudo antes de qualquer arquivo ser gerado.
    const pacote = await planejarPacoteDoLote(lote, parametros.get("modelo"), parte);

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
