// Como o navegador deve enviar o PDF neste ambiente.
import "server-only";
import { modoDeArmazenamento } from "@/modules/storage";

export function modoDeEnvio(): "vercel-blob" | "local" | "indisponivel" {
  try {
    return modoDeArmazenamento();
  } catch {
    return "indisponivel";
  }
}
