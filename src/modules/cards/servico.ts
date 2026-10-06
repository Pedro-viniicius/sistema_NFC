// Casos de uso que alteram cartões. Toda mutação de cartão do sistema passa por aqui.
import { eq } from "drizzle-orm";
import { cartoes, type Cartao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { codigoValido, gerarCodigo, normalizarCodigo } from "./codigo";
import { validarDestinoUrl } from "./destino";
import { statusAoAtivar, statusAoConfigurar } from "./regras";
import type { TipoDestino } from "./tipos";

const MAX_TENTATIVAS_DE_GERACAO = 10;
export const TAMANHO_MAXIMO_DESCRICAO = 200;

export interface DadosDoNovoCartao {
  tipo?: TipoDestino | null;
  descricao?: string | null;
  loteId?: string | null;
}

/**
 * Cria `quantidade` cartões com códigos únicos. Usado tanto para um cartão avulso quanto para lotes.
 * A unicidade é garantida pelo banco (UNIQUE): colisões são descartadas e sorteadas de novo.
 */
export async function criarCartoes(
  db: Banco,
  quantidade: number,
  dados: DadosDoNovoCartao = {},
  gerar: () => string = gerarCodigo,
): Promise<Cartao[]> {
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new ErroDeDominio("ENTRADA_INVALIDA", "A quantidade deve ser um número inteiro positivo.");
  }

  const criados: Cartao[] = [];
  for (let tentativa = 0; criados.length < quantidade; tentativa++) {
    if (tentativa >= MAX_TENTATIVAS_DE_GERACAO) {
      throw new Error("Não foi possível gerar códigos únicos suficientes.");
    }
    const candidatos = new Set<string>();
    const faltam = quantidade - criados.length;
    for (let i = 0; i < faltam; i++) candidatos.add(gerar());

    const inseridos = await db
      .insert(cartoes)
      .values(
        [...candidatos].map((codigo) => ({
          codigo,
          tipo: dados.tipo ?? null,
          descricao: dados.descricao ?? null,
          loteId: dados.loteId ?? null,
        })),
      )
      .onConflictDoNothing({ target: cartoes.codigo })
      .returning();
    criados.push(...inseridos);
  }
  return criados;
}

/** Cria um cartão com um código específico (ex.: importação de cartão já fabricado). */
export async function criarCartaoComCodigo(
  db: Banco,
  codigo: string,
  dados: DadosDoNovoCartao = {},
): Promise<Cartao> {
  if (!codigoValido(codigo)) {
    throw new ErroDeDominio("CODIGO_INVALIDO", "Código de cartão inválido.");
  }
  const [criado] = await db
    .insert(cartoes)
    .values({
      codigo,
      tipo: dados.tipo ?? null,
      descricao: dados.descricao ?? null,
      loteId: dados.loteId ?? null,
    })
    .onConflictDoNothing({ target: cartoes.codigo })
    .returning();
  if (!criado) {
    throw new ErroDeDominio("CODIGO_DUPLICADO", "Já existe um cartão com este código.");
  }
  return criado;
}

function exigirCodigo(entrada: string): string {
  const codigo = normalizarCodigo(entrada);
  if (!codigo) throw new ErroDeDominio("CODIGO_INVALIDO", "Código de cartão inválido.");
  return codigo;
}

/** Executa `alterar` com o cartão travado (SELECT ... FOR UPDATE) dentro de uma transação. */
async function alterarCartao(
  db: Banco,
  codigoInformado: string,
  alterar: (atual: Cartao) => Partial<Omit<Cartao, "id" | "codigo" | "criadoEm">>,
): Promise<Cartao> {
  const codigo = exigirCodigo(codigoInformado);
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(cartoes).where(eq(cartoes.codigo, codigo)).for("update");
    if (!atual) {
      throw new ErroDeDominio("CARTAO_NAO_ENCONTRADO", "Cartão não encontrado.");
    }
    const [atualizado] = await tx
      .update(cartoes)
      .set({ ...alterar(atual), atualizadoEm: new Date() })
      .where(eq(cartoes.id, atual.id))
      .returning();
    return atualizado;
  });
}

export interface ConfiguracaoDeDestino {
  codigo: string;
  tipo: TipoDestino;
  destinoUrl: string;
  /** Se verdadeiro, um cartão INATIVO volta a ATIVO ao ser configurado (ativação rápida). */
  ativar?: boolean;
}

/**
 * Define ou altera o destino do cartão. Só mexe em tipo, destino e status:
 * o código (e portanto a URL permanente, o QR e o NFC) não é tocado.
 */
export async function configurarDestino(db: Banco, entrada: ConfiguracaoDeDestino): Promise<Cartao> {
  const destino = validarDestinoUrl(entrada.destinoUrl, { tipo: entrada.tipo });
  if (!destino.ok) {
    throw new ErroDeDominio("DESTINO_INVALIDO", destino.erro);
  }
  return alterarCartao(db, entrada.codigo, (atual) => {
    const status = statusAoConfigurar(atual.status, entrada.ativar ?? false);
    const agora = new Date();
    return {
      tipo: entrada.tipo,
      destinoUrl: destino.url,
      status,
      ativadoEm: atual.ativadoEm ?? (status === "ATIVO" ? agora : null),
    };
  });
}

export async function ativarCartao(db: Banco, codigo: string): Promise<Cartao> {
  return alterarCartao(db, codigo, (atual) => {
    const status = statusAoAtivar(atual.status, atual.destinoUrl !== null && atual.tipo !== null);
    return {
      status,
      ativadoEm: atual.ativadoEm ?? (status === "ATIVO" ? new Date() : null),
    };
  });
}

export async function desativarCartao(db: Banco, codigo: string): Promise<Cartao> {
  return alterarCartao(db, codigo, () => ({ status: "INATIVO" }));
}

export async function atualizarDescricao(
  db: Banco,
  codigo: string,
  descricao: string | null,
): Promise<Cartao> {
  const texto = descricao?.trim() ?? "";
  if (texto.length > TAMANHO_MAXIMO_DESCRICAO) {
    throw new ErroDeDominio(
      "ENTRADA_INVALIDA",
      `A descrição deve ter no máximo ${TAMANHO_MAXIMO_DESCRICAO} caracteres.`,
    );
  }
  return alterarCartao(db, codigo, () => ({ descricao: texto.length > 0 ? texto : null }));
}
