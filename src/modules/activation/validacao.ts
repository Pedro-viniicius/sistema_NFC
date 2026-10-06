// Validação dos dados da ativação feita pelo cliente. Roda SEMPRE no servidor: a conferência que o
// navegador faz a cada passo chama esta mesma função, então não existem duas versões das regras.
import { PAPEIS, RAMOS, type Papel, type Ramo } from "@/modules/contacts/tipos";
import { validarLinkDoCliente, type TipoComAtivacao } from "./link";
import { normalizarWhatsApp } from "./whatsapp";

export const TAMANHO_MAXIMO_DO_NOME = 80;
const TAMANHO_MINIMO_DO_NOME = 2;

/** Campos do formulário, na ordem em que aparecem, com o passo de cada um. */
export const PASSO_DO_CAMPO = {
  loja: 1,
  ramo: 1,
  nome: 2,
  papel: 2,
  decisor: 2,
  whatsapp: 2,
  link: 3,
} as const;

export type CampoDaAtivacao = keyof typeof PASSO_DO_CAMPO;
export type ErrosDaAtivacao = Partial<Record<CampoDaAtivacao, string>>;

export interface DadosDaAtivacao {
  tipo: TipoComAtivacao;
  loja: string;
  ramo: Ramo | null;
  nome: string;
  papel: Papel;
  /** Quem decide as coisas na loja; nulo quando quem preencheu é o dono. */
  decisor: string | null;
  /** +55 + DDD + número. */
  whatsapp: string;
  aceitouOfertas: boolean;
  /** Link final gravado no cartão. */
  link: string;
  /** O mesmo link, do jeito que é mostrado ao cliente. */
  linkExibido: string;
}

export type ResultadoDaValidacao =
  | { ok: true; dados: DadosDaAtivacao }
  | { ok: false; erros: ErrosDaAtivacao; /** Primeiro passo com erro. */ passo: 1 | 2 | 3 };

/** Texto digitado pela pessoa: sem caracteres de controle, sem espaços sobrando. */
function texto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nomeValido(valor: string): boolean {
  return valor.length >= TAMANHO_MINIMO_DO_NOME && valor.length <= TAMANHO_MAXIMO_DO_NOME && /\p{L}/u.test(valor);
}

interface Analise {
  erros: ErrosDaAtivacao;
  dados: DadosDaAtivacao | null;
  linkExibido: string | null;
}

function analisar(entrada: Record<string, unknown>, tipo: TipoComAtivacao, ate: 1 | 2 | 3): Analise {
  const erros: ErrosDaAtivacao = {};

  const loja = texto(entrada.loja);
  if (!nomeValido(loja)) erros.loja = "Escreva o nome da sua loja ou empresa.";
  const ramoInformado = texto(entrada.ramo);
  const ramo = (RAMOS as readonly string[]).includes(ramoInformado) ? (ramoInformado as Ramo) : null;
  if (ramoInformado.length > 0 && ramo === null) erros.ramo = "Escolha uma das opções.";

  const nome = texto(entrada.nome);
  const papelInformado = texto(entrada.papel);
  const papel = (PAPEIS as readonly string[]).includes(papelInformado) ? (papelInformado as Papel) : null;
  const decisor = texto(entrada.decisor);
  const whatsapp = normalizarWhatsApp(entrada.whatsapp);
  if (ate >= 2) {
    if (!nomeValido(nome)) erros.nome = "Escreva o seu nome.";
    if (!papel) erros.papel = "Escolha uma das opções.";
    if (papel && papel !== "DONO" && !nomeValido(decisor)) {
      erros.decisor = "Escreva o nome de quem decide as coisas na loja.";
    }
    if (!whatsapp.ok) erros.whatsapp = whatsapp.erro;
  }

  const link = validarLinkDoCliente(entrada.link, tipo);
  if (ate >= 3 && !link.ok) erros.link = link.erro;

  const completo = ate === 3 && Object.keys(erros).length === 0 && papel !== null && whatsapp.ok && link.ok;
  return {
    erros,
    linkExibido: link.ok ? link.exibicao : null,
    dados: completo
      ? {
          tipo,
          loja,
          ramo,
          nome,
          papel,
          decisor: papel === "DONO" ? null : decisor,
          whatsapp: whatsapp.numero,
          // Só vale como aceite a caixa marcada de propósito; qualquer outro valor é "não".
          aceitouOfertas: entrada.ofertas === "sim",
          link: link.url,
          linkExibido: link.exibicao,
        }
      : null,
  };
}

/** Primeiro passo que tem algum erro. */
export function passoComErro(erros: ErrosDaAtivacao): 1 | 2 | 3 {
  const passos = (Object.keys(erros) as CampoDaAtivacao[]).map((campo) => PASSO_DO_CAMPO[campo]);
  return Math.min(3, ...passos) as 1 | 2 | 3;
}

/**
 * Conferência de um passo (o botão "Continuar"): valida os campos até o passo `ate` e devolve os
 * erros, em mensagens que dizem ao cliente o que fazer. Não grava nada.
 */
export function conferirPasso(
  entrada: Record<string, unknown>,
  tipo: TipoComAtivacao,
  ate: 1 | 2 | 3,
): { erros: ErrosDaAtivacao; linkExibido: string | null } {
  const { erros, linkExibido } = analisar(entrada, tipo, ate);
  return { erros, linkExibido: ate === 3 ? linkExibido : null };
}

/** Validação completa, feita no envio final: sem todos os dados obrigatórios, nada é ativado. */
export function validarAtivacao(entrada: Record<string, unknown>, tipo: TipoComAtivacao): ResultadoDaValidacao {
  const { erros, dados } = analisar(entrada, tipo, 3);
  return dados ? { ok: true, dados } : { ok: false, erros, passo: passoComErro(erros) };
}
