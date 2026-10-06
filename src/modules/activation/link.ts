// Link que o cliente informa na ativação. A segurança vem da validação de destino já existente
// (src/modules/cards/destino.ts), reaproveitada sem afrouxar nada; aqui ficam só os cuidados a mais
// de quem atende um comerciante: aceitar o @, limpar o texto colado e explicar o erro em língua de gente.
import { validarDestinoUrl } from "@/modules/cards/destino";

export type TipoComAtivacao = "INSTAGRAM" | "GOOGLE";
export const TIPOS_COM_ATIVACAO: readonly TipoComAtivacao[] = ["INSTAGRAM", "GOOGLE"];

export function ehTipoComAtivacao(valor: unknown): valor is TipoComAtivacao {
  return valor === "INSTAGRAM" || valor === "GOOGLE";
}

export type ResultadoDoLink =
  | { ok: true; url: string; /** Como mostrar o link para o cliente, sem "https://". */ exibicao: string }
  | { ok: false; erro: string };

const USUARIO_DO_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
/** Caminhos do Instagram que não são perfis (publicações, vídeos, páginas do próprio aplicativo). */
const NAO_SAO_PERFIS = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "developer", "legal", "share",
]);

const ERROS = {
  INSTAGRAM: {
    vazio: "Escreva o @ da sua loja ou cole o link do perfil.",
    invalido: "Esse link não parece ser do Instagram. Confira e cole de novo.",
    naoEPerfil: "Esse link não é do perfil da loja. Abra o perfil no Instagram, copie o link e cole de novo.",
  },
  GOOGLE: {
    vazio: "Cole aqui o link da sua empresa no Google.",
    invalido: "Esse link não parece ser do Google. Confira e cole de novo.",
    naoEPerfil: "Esse link abre só a página inicial do Google. Copie o link da sua empresa e cole de novo.",
  },
} as const;

/**
 * Quando a pessoa cola um texto com o link no meio (o "compartilhar" de alguns aplicativos manda o
 * nome da loja junto), fica só com o link. Sem um link claro no texto, devolve o texto como veio.
 */
function extrairLink(texto: string): string {
  const limpo = texto.trim();
  if (!/\s/.test(limpo)) return limpo;
  const links = limpo.match(/https?:\/\/\S+/gi) ?? [];
  return links.length === 1 ? links[0] : limpo;
}

function semProtocolo(url: URL, limite = 60): string {
  const texto = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

function linkDoInstagram(entrada: string): ResultadoDoLink {
  // Só o @ (ou só o nome, sem ponto): vira o link do perfil.
  const soUsuario = /^@([A-Za-z0-9._]{1,30})$/.exec(entrada) ?? /^([A-Za-z0-9_]{1,30})$/.exec(entrada);
  const validado = validarDestinoUrl(soUsuario ? `@${soUsuario[1]}` : entrada, { tipo: "INSTAGRAM" });
  if (!validado.ok) return { ok: false, erro: ERROS.INSTAGRAM.invalido };

  const usuario = new URL(validado.url).pathname.split("/").filter(Boolean)[0] ?? "";
  if (!USUARIO_DO_INSTAGRAM.test(usuario) || NAO_SAO_PERFIS.has(usuario.toLowerCase())) {
    return { ok: false, erro: ERROS.INSTAGRAM.naoEPerfil };
  }
  // O cartão guarda sempre o link limpo do perfil, sem códigos de rastreio do compartilhamento.
  return { ok: true, url: `https://www.instagram.com/${usuario}/`, exibicao: `instagram.com/${usuario}` };
}

function linkDoGoogle(entrada: string): ResultadoDoLink {
  const validado = validarDestinoUrl(entrada, { tipo: "GOOGLE" });
  if (!validado.ok) return { ok: false, erro: ERROS.GOOGLE.invalido };
  const url = new URL(validado.url);
  if (url.pathname.replace(/\/+$/, "") === "" && url.search === "") {
    return { ok: false, erro: ERROS.GOOGLE.naoEPerfil };
  }
  return { ok: true, url: validado.url, exibicao: semProtocolo(url) };
}

/** Valida o link informado pelo cliente para o tipo do cartão e devolve o link final do cartão. */
export function validarLinkDoCliente(entrada: unknown, tipo: TipoComAtivacao): ResultadoDoLink {
  if (typeof entrada !== "string" || entrada.trim().length === 0) return { ok: false, erro: ERROS[tipo].vazio };
  const texto = extrairLink(entrada);
  return tipo === "INSTAGRAM" ? linkDoInstagram(texto) : linkDoGoogle(texto);
}
