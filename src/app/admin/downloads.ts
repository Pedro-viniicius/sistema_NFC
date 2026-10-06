// Respostas HTTP dos downloads de produção (PDF, CSV, ZIP).
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { nomeDeArquivoSeguro } from "@/modules/printing/producao";

const SEM_CACHE = "private, no-store";

export const TIPOS_DE_ARQUIVO = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
} as const;

export function respostaDeDownload(
  corpo: BodyInit,
  tipo: keyof typeof TIPOS_DE_ARQUIVO,
  nomeDoArquivo: string,
  disposicao: "attachment" | "inline" = "attachment",
): Response {
  return new Response(corpo, {
    headers: {
      "Content-Type": TIPOS_DE_ARQUIVO[tipo],
      "Content-Disposition": `${disposicao}; filename="${nomeDeArquivoSeguro(nomeDoArquivo)}"`,
      "Cache-Control": SEM_CACHE,
    },
  });
}

function texto(status: number, mensagem: string): Response {
  return new Response(mensagem, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": SEM_CACHE },
  });
}

const NAO_ENCONTRADOS = new Set(["CARTAO_NAO_ENCONTRADO", "LOTE_NAO_ENCONTRADO"]);

/** Erros de regra viram mensagens claras para o administrador; o resto é registrado e vira 500 genérico. */
export function respostaDeErroDeDownload(erro: unknown): Response {
  if (erro instanceof ErroDeDominio) {
    return texto(NAO_ENCONTRADOS.has(erro.codigo) ? 404 : 422, erro.message);
  }
  if (erro instanceof ErroDeConfiguracao) {
    registrarLog("erro", "impressao.configuracao_invalida", { mensagem: erro.message });
    return texto(500, erro.message);
  }
  registrarLog("erro", "impressao.falha_ao_gerar", { mensagem: mensagemDoErro(erro) });
  return texto(500, "Não foi possível gerar o arquivo. Tente novamente.");
}
