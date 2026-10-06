// Armazenamento persistente de arquivos (objetos). O banco guarda só a chave do arquivo.
// Há três implementações: Vercel Blob (produção), disco local (só desenvolvimento) e memória (testes).

export class ErroDeArmazenamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeArmazenamento";
  }
}

/** A leitura foi interrompida porque o arquivo passa do limite informado. */
export class ErroDeArquivoGrandeDemais extends ErroDeArmazenamento {
  constructor(public readonly limiteBytes: number) {
    super(`O arquivo passa do limite de ${limiteBytes} bytes.`);
    this.name = "ErroDeArquivoGrandeDemais";
  }
}

export interface OpcoesDeLeitura {
  /** Interrompe a leitura (com ErroDeArquivoGrandeDemais) se o arquivo for maior que isto. */
  limiteBytes?: number;
}

export interface ArmazenamentoDeArquivos {
  /** Grava um arquivo NOVO. Falha se a chave já existir: um arquivo armazenado nunca é sobrescrito. */
  salvar(chave: string, conteudo: Uint8Array, tipoDeConteudo: string): Promise<void>;
  /** Conteúdo do arquivo, ou null se ele não existir. */
  ler(chave: string, opcoes?: OpcoesDeLeitura): Promise<Uint8Array | null>;
  /** Remove o arquivo. Não falha se ele já não existir. */
  excluir(chave: string): Promise<void>;
  existe(chave: string): Promise<boolean>;
}

/** Chaves aceitas: sem "..", sem barra inicial e só com caracteres seguros. */
const FORMATO_DA_CHAVE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function exigirChaveValida(chave: string): string {
  if (chave.length > 300 || !FORMATO_DA_CHAVE.test(chave) || chave.includes("..")) {
    throw new ErroDeArmazenamento("Chave de arquivo inválida.");
  }
  return chave;
}
