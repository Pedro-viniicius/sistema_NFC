// Exportação dos contatos em CSV: GET /admin/contatos/exportar (aceita os mesmos filtros da lista).
import { obterBanco } from "@/db/cliente";
import { registrarLog } from "@/lib/log";
import { exigirAdminNaRota } from "@/modules/auth/rota";
import { gerarCsvDeContatos, listarContatos } from "@/modules/contacts/servico";
import { respostaDeDownload, respostaDeErroDeDownload } from "@/app/admin/downloads";
import { lerFiltroDeContatos } from "../filtro";

export const runtime = "nodejs";

export async function GET(requisicao: Request): Promise<Response> {
  const admin = await exigirAdminNaRota();
  if (admin instanceof Response) return admin;

  try {
    const parametros = Object.fromEntries(new URL(requisicao.url).searchParams);
    const lista = await listarContatos(obterBanco(), lerFiltroDeContatos(parametros));
    // Exportar dados pessoais fica registrado: quem exportou e quantos contatos, sem os dados em si.
    registrarLog("info", "contatos.exportados", { quantidade: lista.length, adminId: admin.id });
    const hoje = new Date().toISOString().slice(0, 10);
    return respostaDeDownload(gerarCsvDeContatos(lista), "csv", `contatos-${hoje}.csv`);
  } catch (erro) {
    return respostaDeErroDeDownload(erro);
  }
}
