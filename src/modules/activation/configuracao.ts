// Dados de quem atende e de quem responde pelos dados pessoais. Vêm de variáveis de ambiente
// (nunca ficam fixos no código) e são lidos só no servidor.
import { normalizarWhatsApp } from "./whatsapp";

export interface ConfiguracaoDeAtivacao {
  /** WhatsApp de atendimento do administrador, no formato +55… */
  whatsappDeAtendimento: string;
  responsavel: {
    /** Nome ou razão social. */
    nome: string;
    /** CNPJ ou CPF. */
    documento: string;
    email: string;
  };
}

export const VARIAVEIS_DA_ATIVACAO = {
  whatsapp: "ATENDIMENTO_WHATSAPP",
  nome: "RESPONSAVEL_DADOS_NOME",
  documento: "RESPONSAVEL_DADOS_DOCUMENTO",
  email: "RESPONSAVEL_DADOS_EMAIL",
} as const;

function ler(ambiente: NodeJS.ProcessEnv, variavel: string): string {
  return ambiente[variavel]?.trim() ?? "";
}

/** O que falta configurar para a ativação pelo cliente poder ser ligada. Lista vazia = tudo certo. */
export function pendenciasDaConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): string[] {
  const pendencias: string[] = [];
  const whatsapp = ler(ambiente, VARIAVEIS_DA_ATIVACAO.whatsapp);
  if (!whatsapp) pendencias.push(`${VARIAVEIS_DA_ATIVACAO.whatsapp} (WhatsApp de atendimento, com DDD)`);
  else if (!normalizarWhatsApp(whatsapp).ok) {
    pendencias.push(`${VARIAVEIS_DA_ATIVACAO.whatsapp} (o número informado não é válido)`);
  }
  if (!ler(ambiente, VARIAVEIS_DA_ATIVACAO.nome)) {
    pendencias.push(`${VARIAVEIS_DA_ATIVACAO.nome} (nome ou razão social de quem responde pelos dados)`);
  }
  if (!ler(ambiente, VARIAVEIS_DA_ATIVACAO.documento)) {
    pendencias.push(`${VARIAVEIS_DA_ATIVACAO.documento} (CNPJ ou CPF)`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ler(ambiente, VARIAVEIS_DA_ATIVACAO.email))) {
    pendencias.push(`${VARIAVEIS_DA_ATIVACAO.email} (e-mail para pedidos sobre dados pessoais)`);
  }
  return pendencias;
}

/** Configuração completa, ou null se faltar algum dado (a ativação pelo cliente fica indisponível). */
export function obterConfiguracaoDeAtivacao(ambiente: NodeJS.ProcessEnv = process.env): ConfiguracaoDeAtivacao | null {
  if (pendenciasDaConfiguracao(ambiente).length > 0) return null;
  const whatsapp = normalizarWhatsApp(ler(ambiente, VARIAVEIS_DA_ATIVACAO.whatsapp));
  if (!whatsapp.ok) return null;
  return {
    whatsappDeAtendimento: whatsapp.numero,
    responsavel: {
      nome: ler(ambiente, VARIAVEIS_DA_ATIVACAO.nome),
      documento: ler(ambiente, VARIAVEIS_DA_ATIVACAO.documento),
      email: ler(ambiente, VARIAVEIS_DA_ATIVACAO.email),
    },
  };
}
