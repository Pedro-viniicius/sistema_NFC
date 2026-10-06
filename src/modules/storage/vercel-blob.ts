// Armazenamento no Vercel Blob, com acesso PRIVADO: os arquivos só saem pelas rotas do painel,
// que conferem a sessão do administrador. A URL do blob nunca é exposta.
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import {
  ErroDeArquivoGrandeDemais,
  exigirChaveValida,
  type ArmazenamentoDeArquivos,
  type OpcoesDeLeitura,
} from "./tipos";

export const ACESSO_DO_BLOB = "private" as const;

async function lerFluxo(fluxo: ReadableStream<Uint8Array>, limiteBytes: number | undefined): Promise<Uint8Array> {
  const pedacos: Uint8Array[] = [];
  let total = 0;
  const leitor = fluxo.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (limiteBytes !== undefined && total > limiteBytes) {
      await leitor.cancel();
      throw new ErroDeArquivoGrandeDemais(limiteBytes);
    }
    pedacos.push(value);
  }
  const conteudo = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    conteudo.set(pedaco, posicao);
    posicao += pedaco.length;
  }
  return conteudo;
}

export class ArmazenamentoVercelBlob implements ArmazenamentoDeArquivos {
  async salvar(chave: string, conteudo: Uint8Array, tipoDeConteudo: string): Promise<void> {
    await put(exigirChaveValida(chave), Buffer.from(conteudo), {
      access: ACESSO_DO_BLOB,
      contentType: tipoDeConteudo,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  async ler(chave: string, opcoes: OpcoesDeLeitura = {}): Promise<Uint8Array | null> {
    const resultado = await get(exigirChaveValida(chave), { access: ACESSO_DO_BLOB });
    if (!resultado || resultado.statusCode !== 200) return null;
    return lerFluxo(resultado.stream, opcoes.limiteBytes);
  }

  async excluir(chave: string): Promise<void> {
    await del(exigirChaveValida(chave));
  }

  async existe(chave: string): Promise<boolean> {
    try {
      await head(exigirChaveValida(chave));
      return true;
    } catch (erro) {
      if (erro instanceof BlobNotFoundError) return false;
      throw erro;
    }
  }
}
