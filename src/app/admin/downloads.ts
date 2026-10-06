// Respostas HTTP dos downloads de produção (PDF, CSV, ZIP).
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { ErroDeArmazenamento } from "@/modules/storage/tipos";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { nomeDeArquivoSeguro } from "@/modules/printing/producao";

const SEM_CACHE = "private, no-store";

export const TIPOS_DE_ARQUIVO = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
} as const;

/** Pedaços em que um arquivo binário é entregue. */
const TAMANHO_DO_PEDACO = 256 * 1024;

/**
 * Entrega os bytes como um FLUXO, em pedaços. Na Vercel, uma resposta montada de uma vez só é
 * limitada a 4,5 MB; uma resposta em fluxo não tem esse limite — e um PDF de template pode ter 25 MB.
 */
function emFluxo(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let posicao = 0;
  return new ReadableStream({
    pull(controlador) {
      if (posicao >= bytes.length) {
        controlador.close();
        return;
      }
      controlador.enqueue(bytes.subarray(posicao, posicao + TAMANHO_DO_PEDACO));
      posicao += TAMANHO_DO_PEDACO;
    },
  });
}

export function respostaDeDownload(
  corpo: string | Uint8Array | ArrayBuffer,
  tipo: keyof typeof TIPOS_DE_ARQUIVO,
  nomeDoArquivo: string,
  disposicao: "attachment" | "inline" = "attachment",
): Response {
  const cabecalhos = new Headers({
    "Content-Type": TIPOS_DE_ARQUIVO[tipo],
    "Content-Disposition": `${disposicao}; filename="${nomeDeArquivoSeguro(nomeDoArquivo)}"`,
    "Cache-Control": SEM_CACHE,
  });
  if (typeof corpo === "string") return new Response(corpo, { headers: cabecalhos });

  const bytes = corpo instanceof Uint8Array ? corpo : new Uint8Array(corpo);
  cabecalhos.set("Content-Length", String(bytes.length));
  return new Response(emFluxo(bytes), { headers: cabecalhos });
}

function texto(status: number, mensagem: string): Response {
  return new Response(mensagem, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": SEM_CACHE },
  });
}

const NAO_ENCONTRADOS = new Set(["CARTAO_NAO_ENCONTRADO", "LOTE_NAO_ENCONTRADO", "TEMPLATE_NAO_ENCONTRADO"]);

/** Erros de regra viram mensagens claras para o administrador; o resto é registrado e vira 500 genérico. */
export function respostaDeErroDeDownload(erro: unknown): Response {
  if (erro instanceof ErroDeDominio) {
    return texto(NAO_ENCONTRADOS.has(erro.codigo) ? 404 : 422, erro.message);
  }
  if (erro instanceof ErroDeConfiguracao) {
    registrarLog("erro", "impressao.configuracao_invalida", { mensagem: erro.message });
    return texto(500, erro.message);
  }
  if (erro instanceof ErroDeArmazenamento) {
    registrarLog("erro", "impressao.falha_no_armazenamento", { mensagem: erro.message });
    return texto(502, "Não foi possível ler o arquivo do template no armazenamento. Tente novamente.");
  }
  registrarLog("erro", "impressao.falha_ao_gerar", { mensagem: mensagemDoErro(erro) });
  return texto(500, "Não foi possível gerar o arquivo. Tente novamente.");
}
