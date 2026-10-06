// Decide o que acontece quando alguém acessa a URL permanente de um cartão.
// Única implementação da regra de redirecionamento do sistema.
import type { Banco } from "@/db/tipos";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { validarDestinoUrl } from "@/modules/cards/destino";
import { buscarParaRedirecionar } from "@/modules/cards/repositorio";

export type Resolucao =
  | { situacao: "REDIRECIONAR"; destino: string; cartaoId: string }
  | { situacao: "NAO_CONFIGURADO" }
  | { situacao: "INATIVO" }
  | { situacao: "NAO_ENCONTRADO"; motivo: "CODIGO_INVALIDO" | "INEXISTENTE" }
  | { situacao: "DESTINO_INVALIDO"; cartaoId: string };

/**
 * O destino vem SEMPRE do banco: nenhum parâmetro da requisição além do código é considerado.
 * O destino salvo é validado de novo antes de redirecionar (defesa em profundidade).
 */
export async function resolverRedirecionamento(db: Banco, codigoBruto: unknown): Promise<Resolucao> {
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) {
    return { situacao: "NAO_ENCONTRADO", motivo: "CODIGO_INVALIDO" };
  }

  const cartao = await buscarParaRedirecionar(db, codigo);
  if (!cartao) {
    return { situacao: "NAO_ENCONTRADO", motivo: "INEXISTENTE" };
  }
  if (cartao.status === "INATIVO") return { situacao: "INATIVO" };
  if (cartao.status === "NAO_CONFIGURADO") return { situacao: "NAO_CONFIGURADO" };

  const destino = validarDestinoUrl(cartao.destinoUrl);
  if (!destino.ok) {
    return { situacao: "DESTINO_INVALIDO", cartaoId: cartao.id };
  }
  return { situacao: "REDIRECIONAR", destino: destino.url, cartaoId: cartao.id };
}
