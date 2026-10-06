// Forma serializável do cartão enviada aos componentes de cliente.
import type { Cartao } from "@/db/schema";
import type { StatusCartao, TipoDestino } from "./tipos";
import { getCardPublicUrl } from "./url-publica";

export interface CartaoResumo {
  codigo: string;
  /** URL permanente: a mesma do QR Code e do NFC. */
  urlPermanente: string;
  status: StatusCartao;
  tipo: TipoDestino | null;
  destinoUrl: string | null;
  descricao: string | null;
}

export function resumirCartao(cartao: Cartao): CartaoResumo {
  return {
    codigo: cartao.codigo,
    urlPermanente: getCardPublicUrl(cartao.codigo),
    status: cartao.status,
    tipo: cartao.tipo,
    destinoUrl: cartao.destinoUrl,
    descricao: cartao.descricao,
  };
}
