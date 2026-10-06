// Token de sessão (JWT assinado com HS256). Sem estado no servidor.
import { SignJWT, jwtVerify } from "jose";

const EMISSOR = "sistema-nfc";
const PUBLICO = "painel-admin";

export const COOKIE_DE_SESSAO = "sessao_admin";
export const DURACAO_DA_SESSAO_EM_SEGUNDOS = 60 * 60 * 24 * 7;

export function assinarTokenDeSessao(
  adminId: string,
  segredo: Uint8Array,
  duracaoEmSegundos: number = DURACAO_DA_SESSAO_EM_SEGUNDOS,
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(EMISSOR)
    .setAudience(PUBLICO)
    .setIssuedAt(agora)
    .setExpirationTime(agora + duracaoEmSegundos)
    .sign(segredo);
}

/** Devolve o id do administrador, ou null se o token for inválido, adulterado ou expirado. */
export async function verificarTokenDeSessao(
  token: string | undefined,
  segredo: Uint8Array,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, segredo, {
      algorithms: ["HS256"],
      issuer: EMISSOR,
      audience: PUBLICO,
    });
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
