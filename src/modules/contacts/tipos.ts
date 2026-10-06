// Constantes e tipos dos contatos de quem ativa um cartão. Sem dependências: servidor e cliente.

/** Ramo do negócio (opcional na ativação). */
export const RAMOS = ["RESTAURANTE", "BELEZA", "VAREJO", "SAUDE", "SERVICOS", "OUTRO"] as const;
export type Ramo = (typeof RAMOS)[number];

export const ROTULO_RAMO: Record<Ramo, string> = {
  RESTAURANTE: "Restaurante e lanchonete",
  BELEZA: "Beleza e estética",
  VAREJO: "Loja e varejo",
  SAUDE: "Saúde",
  SERVICOS: "Serviços",
  OUTRO: "Outro",
};

/** Papel de quem preencheu a ativação, em relação ao negócio. */
export const PAPEIS = ["DONO", "GERENTE", "FUNCIONARIO", "OUTRO"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  DONO: "Sou eu, o dono",
  GERENTE: "Sou gerente",
  FUNCIONARIO: "Trabalho aqui",
  OUTRO: "Outro",
};

/** Como o papel aparece no painel do administrador. */
export const PAPEL_NO_PAINEL: Record<Papel, string> = {
  DONO: "Dono",
  GERENTE: "Gerente",
  FUNCIONARIO: "Funcionário",
  OUTRO: "Outro",
};

/** Andamento da conversa de venda com o contato. */
export const SITUACOES_DO_CONTATO = ["NOVO", "CONVERSANDO", "CLIENTE", "SEM_INTERESSE"] as const;
export type SituacaoDoContato = (typeof SITUACOES_DO_CONTATO)[number];

export const ROTULO_SITUACAO: Record<SituacaoDoContato, string> = {
  NOVO: "Novo",
  CONVERSANDO: "Conversando",
  CLIENTE: "Virou cliente",
  SEM_INTERESSE: "Sem interesse",
};

export function ehSituacaoDoContato(valor: unknown): valor is SituacaoDoContato {
  return typeof valor === "string" && (SITUACOES_DO_CONTATO as readonly string[]).includes(valor);
}

export const TAMANHO_MAXIMO_DA_OBSERVACAO = 1000;
