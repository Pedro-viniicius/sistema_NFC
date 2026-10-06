// URL canônica dos cartões. É o ÚNICO lugar do sistema que monta a URL permanente:
// o QR Code e o NFC usam sempre o resultado de getCardPublicUrl().
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { CODIGO_DE_TESTE, codigoValido } from "./codigo";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1"]);

/** Origem canônica (ex.: https://go.meudominio.com), lida de NEXT_PUBLIC_APP_URL. */
export function obterUrlBase(): string {
  const valor = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!valor) {
    throw new ErroDeConfiguracao("A variável NEXT_PUBLIC_APP_URL não está definida.");
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErroDeConfiguracao("NEXT_PUBLIC_APP_URL não é uma URL válida.");
  }

  const local = HOSTS_LOCAIS.has(url.hostname);
  const producao = process.env.NODE_ENV === "production";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !producao)) {
    throw new ErroDeConfiguracao("NEXT_PUBLIC_APP_URL deve usar https://.");
  }
  if (local && producao) {
    throw new ErroDeConfiguracao("NEXT_PUBLIC_APP_URL não pode ser localhost em produção.");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new ErroDeConfiguracao(
      "NEXT_PUBLIC_APP_URL deve conter apenas o domínio, sem caminho (ex.: https://go.meudominio.com).",
    );
  }
  return url.origin;
}

/** URL permanente do cartão: a mesma para o QR Code impresso e para o chip NFC. */
export function getCardPublicUrl(codigo: string): string {
  if (!codigoValido(codigo)) {
    throw new ErroDeDominio("CODIGO_INVALIDO", "Código de cartão inválido.");
  }
  return `${obterUrlBase()}/c/${codigo}`;
}

/**
 * URL usada nos testes de impressão: a URL base real com o código reservado, que nunca pertence
 * a um cartão. Tem o mesmo comprimento de uma URL permanente de verdade.
 */
export function urlDeTesteDoQr(): string {
  return `${obterUrlBase()}/c/${CODIGO_DE_TESTE}`;
}

/** Host do próprio sistema, ou null se a URL base estiver mal configurada. */
export function hostDoApp(): string | null {
  try {
    return new URL(obterUrlBase()).hostname;
  } catch {
    return null;
  }
}

/**
 * Aviso para o painel quando a URL base não parece ser o domínio definitivo.
 * Cartões impressos com a URL errada não têm conserto.
 */
export function avisoDaUrlBase(): string | null {
  let host: string;
  try {
    host = new URL(obterUrlBase()).hostname;
  } catch (erro) {
    return erro instanceof Error ? erro.message : "NEXT_PUBLIC_APP_URL inválida.";
  }
  if (HOSTS_LOCAIS.has(host)) {
    return "A URL base é localhost (ambiente de desenvolvimento). Não imprima cartões nem grave NFC com esta URL.";
  }
  if (host.endsWith(".vercel.app")) {
    return "A URL base é um endereço .vercel.app. Configure o domínio definitivo em NEXT_PUBLIC_APP_URL antes de imprimir cartões.";
  }
  return null;
}
