// Ativação do cartão pelo próprio cliente, na URL permanente do cartão.
//
// Só vale para cartões NÃO configurados de lotes marcados no painel como "Ativação pelo cliente".
// A ativação é atômica: contato, link e mudança de estado são gravados na mesma transação, com a
// linha do cartão travada. Se duas pessoas enviarem ao mesmo tempo, só a primeira vence.
import { and, eq } from "drizzle-orm";
import { cartoes, contatos, lotes, type Contato, type Lote } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { ROTULO_TIPO } from "@/modules/cards/tipos";
import { ehTipoComAtivacao, type TipoComAtivacao } from "./link";
import type { DadosDaAtivacao } from "./validacao";

export interface CartaoParaAtivar {
  cartaoId: string;
  codigo: string;
  tipo: TipoComAtivacao;
  loteIdentificador: string;
}

/**
 * O cartão pode ser ativado pelo cliente agora? Consulta de leitura, usada ao abrir a página.
 * Devolve null em qualquer outro caso (cartão já configurado ou inativo, sem lote, lote sem a opção).
 */
export async function buscarCartaoParaAtivar(db: Banco, codigoInformado: unknown): Promise<CartaoParaAtivar | null> {
  const codigo = normalizarCodigo(codigoInformado);
  if (!codigo) return null;
  const [linha] = await db
    .select({
      cartaoId: cartoes.id,
      codigo: cartoes.codigo,
      tipoDoCartao: cartoes.tipo,
      tipoDoLote: lotes.tipo,
      loteIdentificador: lotes.identificador,
    })
    .from(cartoes)
    .innerJoin(lotes, eq(lotes.id, cartoes.loteId))
    .where(
      and(eq(cartoes.codigo, codigo), eq(cartoes.status, "NAO_CONFIGURADO"), eq(lotes.ativacaoPeloCliente, true)),
    )
    .limit(1);
  const tipo = linha?.tipoDoCartao ?? linha?.tipoDoLote;
  if (!linha || !ehTipoComAtivacao(tipo)) return null;
  return { cartaoId: linha.cartaoId, codigo: linha.codigo, tipo, loteIdentificador: linha.loteIdentificador };
}

export type ResultadoDaAtivacao =
  | { resultado: "ATIVADO"; contato: Contato }
  /** Outra pessoa (ou outro envio) ativou o cartão antes. Nada foi alterado. */
  | { resultado: "JA_ATIVADO" }
  /** O cartão não pode ser ativado pelo cliente (lote sem a opção, cartão inativo…). Nada foi alterado. */
  | { resultado: "INDISPONIVEL" };

/**
 * Ativa o cartão com os dados JÁ validados do cliente. Tudo acontece em uma transação:
 *   1. trava a linha do cartão;
 *   2. confere que ele ainda está "não configurado" e que o lote aceita ativação pelo cliente;
 *   3. grava link, tipo e estado ATIVO — com a condição "ainda não configurado" na própria gravação;
 *   4. grava o contato.
 * Se qualquer passo falhar, nada é gravado.
 */
export async function ativarPeloCliente(
  db: Banco,
  codigoInformado: unknown,
  dados: DadosDaAtivacao,
  versaoDoTexto: string,
  agora: Date = new Date(),
): Promise<ResultadoDaAtivacao> {
  const codigo = normalizarCodigo(codigoInformado);
  if (!codigo) return { resultado: "INDISPONIVEL" };

  return db.transaction(async (tx) => {
    const [cartao] = await tx.select().from(cartoes).where(eq(cartoes.codigo, codigo)).for("update");
    if (!cartao) return { resultado: "INDISPONIVEL" };
    if (cartao.status === "ATIVO") return { resultado: "JA_ATIVADO" };
    if (cartao.status !== "NAO_CONFIGURADO" || cartao.destinoUrl !== null || !cartao.loteId) {
      return { resultado: "INDISPONIVEL" };
    }

    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, cartao.loteId)).limit(1);
    const tipo = cartao.tipo ?? lote?.tipo;
    if (!lote?.ativacaoPeloCliente || tipo !== dados.tipo) return { resultado: "INDISPONIVEL" };

    const [ativado] = await tx
      .update(cartoes)
      .set({ tipo: dados.tipo, destinoUrl: dados.link, status: "ATIVO", ativadoEm: agora, atualizadoEm: agora })
      .where(and(eq(cartoes.id, cartao.id), eq(cartoes.status, "NAO_CONFIGURADO")))
      .returning({ id: cartoes.id });
    if (!ativado) return { resultado: "JA_ATIVADO" };

    const [contato] = await tx
      .insert(contatos)
      .values({
        cartaoId: cartao.id,
        cartaoCodigo: cartao.codigo,
        loteIdentificador: lote.identificador,
        tipo: dados.tipo,
        loja: dados.loja,
        ramo: dados.ramo,
        nome: dados.nome,
        papel: dados.papel,
        decisor: dados.decisor,
        whatsapp: dados.whatsapp,
        aceitouOfertas: dados.aceitouOfertas,
        versaoDoTexto,
        registradoEm: agora,
        atualizadoEm: agora,
      })
      .returning();
    return { resultado: "ATIVADO", contato };
  });
}

/**
 * Liga ou desliga "Ativação pelo cliente" em um lote. Para ligar, o lote precisa ser de Instagram
 * ou de Google (é o que define qual link o cliente informa) e o atendimento precisa estar configurado.
 */
export async function definirAtivacaoPeloCliente(
  db: Banco,
  identificador: string,
  ligar: boolean,
  pendenciasDeConfiguracao: readonly string[],
): Promise<Lote> {
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.identificador, identificador)).for("update");
    if (!lote) throw new ErroDeDominio("LOTE_NAO_ENCONTRADO", "Lote não encontrado.");

    if (ligar && !ehTipoComAtivacao(lote.tipo)) {
      throw new ErroDeDominio(
        "ENTRADA_INVALIDA",
        `A ativação pelo cliente só existe para lotes de ${ROTULO_TIPO.INSTAGRAM} ou de ${ROTULO_TIPO.GOOGLE}. ` +
          "Este lote não tem um desses tipos.",
      );
    }
    if (ligar && pendenciasDeConfiguracao.length > 0) {
      throw new ErroDeDominio(
        "ENTRADA_INVALIDA",
        `Antes de liberar a ativação pelo cliente, configure na Vercel: ${pendenciasDeConfiguracao.join("; ")}.`,
      );
    }
    const [atualizado] = await tx
      .update(lotes)
      .set({ ativacaoPeloCliente: ligar })
      .where(eq(lotes.id, lote.id))
      .returning();
    return atualizado;
  });
}
