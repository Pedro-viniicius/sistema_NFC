// Limite de tentativas da página pública de ativação, por IP e por cartão.
//
// O contador fica no banco (tabela limites_de_tentativas): na Vercel cada requisição pode cair em
// uma instância diferente, então um contador em memória não protegeria nada.
import { createHmac } from "node:crypto";
import { lte, sql } from "drizzle-orm";
import { limitesDeTentativas } from "@/db/schema";
import type { Banco } from "@/db/tipos";

export interface RegraDeLimite {
  /** Quantas tentativas cabem na janela. */
  maximo: number;
  janelaEmSegundos: number;
}

const QUINZE_MINUTOS = 15 * 60;

/** Limites da ativação pelo cliente. O envio final é bem mais restrito que a conferência dos passos. */
export const LIMITES_DA_ATIVACAO = {
  /** Envios finais ("Está certo, ativar") para o mesmo cartão. */
  envioPorCartao: { maximo: 8, janelaEmSegundos: QUINZE_MINUTOS },
  /** Envios finais vindos do mesmo endereço IP. */
  envioPorIp: { maximo: 20, janelaEmSegundos: QUINZE_MINUTOS },
  /** Conferências de passo ("Continuar") para o mesmo cartão. */
  conferenciaPorCartao: { maximo: 60, janelaEmSegundos: QUINZE_MINUTOS },
  /** Conferências de passo vindas do mesmo endereço IP. */
  conferenciaPorIp: { maximo: 120, janelaEmSegundos: QUINZE_MINUTOS },
} as const satisfies Record<string, RegraDeLimite>;

export interface ResultadoDoLimite {
  permitido: boolean;
  contagem: number;
}

/**
 * Conta mais uma tentativa para a chave e diz se ela ainda cabe no limite. A contagem é feita em
 * UMA instrução no banco (inserir ou somar), então duas requisições simultâneas não se atropelam.
 * Quando a janela termina, a contagem recomeça do 1.
 */
export async function registrarTentativa(
  db: Banco,
  chave: string,
  regra: RegraDeLimite,
  agora: Date = new Date(),
): Promise<ResultadoDoLimite> {
  const momento = agora.toISOString();
  const fim = new Date(agora.getTime() + regra.janelaEmSegundos * 1000).toISOString();
  const vencida = sql`${limitesDeTentativas.expiraEm} <= ${momento}::timestamptz`;

  const [linha] = await db
    .insert(limitesDeTentativas)
    .values({ chave, contagem: 1, inicio: agora, expiraEm: new Date(fim) })
    .onConflictDoUpdate({
      target: limitesDeTentativas.chave,
      set: {
        contagem: sql`case when ${vencida} then 1 else ${limitesDeTentativas.contagem} + 1 end`,
        inicio: sql`case when ${vencida} then ${momento}::timestamptz else ${limitesDeTentativas.inicio} end`,
        expiraEm: sql`case when ${vencida} then ${fim}::timestamptz else ${limitesDeTentativas.expiraEm} end`,
      },
    })
    .returning({ contagem: limitesDeTentativas.contagem });

  return { permitido: linha.contagem <= regra.maximo, contagem: linha.contagem };
}

/** Apaga contadores de janelas já encerradas, para a tabela não crescer sem fim. */
export async function limparLimitesVencidos(db: Banco, agora: Date = new Date()): Promise<void> {
  await db.delete(limitesDeTentativas).where(lte(limitesDeTentativas.expiraEm, agora));
}

/**
 * Chave do contador por IP. O IP não é guardado em claro: entra só um resumo com segredo, que não
 * permite descobrir o endereço original. Sem IP conhecido, todos caem no mesmo contador.
 */
export function chaveDoIp(finalidade: string, ip: string | undefined, segredo: Uint8Array): string {
  const resumo = createHmac("sha256", segredo).update(ip?.trim() || "desconhecido").digest("hex").slice(0, 24);
  return `${finalidade}:ip:${resumo}`;
}

export function chaveDoCartao(finalidade: string, codigo: string): string {
  return `${finalidade}:cartao:${codigo}`;
}
