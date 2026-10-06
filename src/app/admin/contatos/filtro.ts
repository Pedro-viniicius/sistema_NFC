// Lê os filtros da lista de contatos a partir da URL (lista e exportação usam os mesmos).
import type { FiltroDeContatos } from "@/modules/contacts/servico";
import { ehSituacaoDoContato } from "@/modules/contacts/tipos";

type Parametro = string | string[] | undefined | null;

function primeiro(valor: Parametro): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? "").trim();
}

export function lerFiltroDeContatos(parametros: Record<string, Parametro>): FiltroDeContatos {
  const situacao = primeiro(parametros.situacao);
  const ofertas = primeiro(parametros.ofertas);
  const lote = primeiro(parametros.lote);
  return {
    busca: primeiro(parametros.q).slice(0, 100) || undefined,
    lote: /^lote-\d{4}-\d{3,}$/.test(lote) ? lote : undefined,
    situacao: ehSituacaoDoContato(situacao) ? situacao : undefined,
    aceitouOfertas: ofertas === "sim" ? true : ofertas === "nao" ? false : undefined,
  };
}

/** Os mesmos filtros, de volta para a URL (link de exportação). */
export function filtroParaConsulta(filtro: FiltroDeContatos): string {
  const consulta = new URLSearchParams();
  if (filtro.busca) consulta.set("q", filtro.busca);
  if (filtro.lote) consulta.set("lote", filtro.lote);
  if (filtro.situacao) consulta.set("situacao", filtro.situacao);
  if (filtro.aceitouOfertas !== undefined) consulta.set("ofertas", filtro.aceitouOfertas ? "sim" : "nao");
  const texto = consulta.toString();
  return texto ? `?${texto}` : "";
}
