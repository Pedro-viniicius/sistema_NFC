// Validação centralizada de URLs de destino. Usada ao salvar (servidor), na pré-visualização
// (cliente) e novamente no momento do redirecionamento.
import { hostDoApp } from "./url-publica";
import type { TipoDestino } from "./tipos";

export type ResultadoDestino = { ok: true; url: string } | { ok: false; erro: string };

export interface OpcoesDestino {
  /** Quando informado, exige que o domínio seja compatível com o tipo. */
  tipo?: TipoDestino;
  /** Permite http:// e localhost. Padrão: apenas fora de produção. */
  desenvolvimento?: boolean;
}

export const TAMANHO_MAXIMO_URL = 2048;

const DOMINIOS_POR_TIPO: Partial<Record<TipoDestino, readonly string[]>> = {
  INSTAGRAM: ["instagram.com", "instagr.am"],
  GOOGLE: ["google.com", "google.com.br", "g.page", "goo.gl", "g.co", "share.google"],
};

const ERRO_POR_TIPO: Partial<Record<TipoDestino, string>> = {
  INSTAGRAM: "Para o tipo Instagram, informe um link do instagram.com (ou @usuario).",
  GOOGLE: "Para o tipo Google, informe um link do Google (ex.: g.page, google.com, maps.app.goo.gl).",
};

const USUARIO_INSTAGRAM = /^@([A-Za-z0-9._]{1,30})$/;
const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;
const CARACTERES_PROIBIDOS = /[\s\\\u0000-\u001f\u007f]/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

function falha(erro: string): ResultadoDestino {
  return { ok: false, erro };
}

function pertenceAoDominio(host: string, dominio: string): boolean {
  return host === dominio || host.endsWith(`.${dominio}`);
}

function hostPublicoValido(host: string): boolean {
  if (host.startsWith("[") || IPV4.test(host)) return false;
  const partes = host.split(".");
  if (partes.length < 2 || partes.some((parte) => parte.length === 0)) return false;
  return TLD.test(partes[partes.length - 1]);
}

/**
 * Valida e normaliza uma URL de destino.
 * Só aceita https:// (e http:// em desenvolvimento). Rejeita javascript:, data:, file:,
 * credenciais embutidas, IPs, e links que apontem para o próprio sistema (evita laço).
 */
export function validarDestinoUrl(entrada: unknown, opcoes: OpcoesDestino = {}): ResultadoDestino {
  const desenvolvimento = opcoes.desenvolvimento ?? process.env.NODE_ENV !== "production";

  if (typeof entrada !== "string") return falha("Informe a URL de destino.");
  let texto = entrada.trim();
  if (texto.length === 0) return falha("Informe a URL de destino.");
  if (texto.length > TAMANHO_MAXIMO_URL) return falha("A URL de destino é longa demais.");

  const usuario = opcoes.tipo === "INSTAGRAM" ? USUARIO_INSTAGRAM.exec(texto) : null;
  if (usuario) {
    texto = `https://www.instagram.com/${usuario[1]}/`;
  }

  if (CARACTERES_PROIBIDOS.test(texto)) {
    return falha("A URL não pode conter espaços nem caracteres especiais de controle.");
  }
  if (texto.startsWith("/")) return falha("Informe a URL completa, começando com https://.");
  if (!TEM_ESQUEMA.test(texto)) {
    texto = `https://${texto}`;
  }

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return falha("URL inválida. Exemplo: https://instagram.com/minhaempresa");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && desenvolvimento)) {
    return falha("Apenas links https:// são aceitos.");
  }
  if (url.username || url.password) {
    return falha("A URL não pode conter usuário ou senha.");
  }

  const host = url.hostname.toLowerCase();
  const local = host === "localhost" && desenvolvimento;
  if (!local && !hostPublicoValido(host)) {
    return falha("O domínio da URL não é válido.");
  }
  if (host === hostDoApp()) {
    return falha("O destino não pode apontar para o próprio sistema de cartões.");
  }

  const dominios = opcoes.tipo ? DOMINIOS_POR_TIPO[opcoes.tipo] : undefined;
  if (dominios && !dominios.some((dominio) => pertenceAoDominio(host, dominio))) {
    return falha(ERRO_POR_TIPO[opcoes.tipo!] ?? "O link não corresponde ao tipo escolhido.");
  }

  return { ok: true, url: url.href };
}

/**
 * Sugere o tipo a partir de um link completo (usado ao colar a URL na ativação rápida).
 * Devolve null se o link não for um destino válido.
 */
export function sugerirTipo(entrada: unknown, opcoes: Pick<OpcoesDestino, "desenvolvimento"> = {}): TipoDestino | null {
  if (validarDestinoUrl(entrada, { ...opcoes, tipo: "INSTAGRAM" }).ok) return "INSTAGRAM";
  if (validarDestinoUrl(entrada, { ...opcoes, tipo: "GOOGLE" }).ok) return "GOOGLE";
  return validarDestinoUrl(entrada, opcoes).ok ? "GENERICO" : null;
}
