// Exportação do lote para a gráfica: GET /admin/lotes/[identificador]/exportar?formato=zip|csv
import { obterBanco } from "@/db/cliente";
import { ErroDeDominio } from "@/lib/erros";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { gerarCsvDoLote, gerarZipDoLote } from "@/modules/batches/exportacao";
import { buscarLotePorIdentificador } from "@/modules/batches/servico";
import { listarCartoesDoLote } from "@/modules/cards/repositorio";

export async function GET(
  requisicao: Request,
  contexto: { params: Promise<{ identificador: string }> },
): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  const db = obterBanco();
  const { identificador } = await contexto.params;
  const lote = await buscarLotePorIdentificador(db, identificador).catch((erro: unknown) => {
    if (erro instanceof ErroDeDominio) return null;
    throw erro;
  });
  if (!lote) return new Response("Lote não encontrado.", { status: 404 });

  const cartoes = await listarCartoesDoLote(db, lote.id);
  const formato = new URL(requisicao.url).searchParams.get("formato") === "csv" ? "csv" : "zip";

  if (formato === "csv") {
    return new Response(gerarCsvDoLote(cartoes), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${lote.identificador}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response(await gerarZipDoLote(lote, cartoes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${lote.identificador}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
