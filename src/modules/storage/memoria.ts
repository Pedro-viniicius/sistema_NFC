// Armazenamento em memória, usado nos testes.
import {
  ErroDeArmazenamento,
  ErroDeArquivoGrandeDemais,
  exigirChaveValida,
  type ArmazenamentoDeArquivos,
  type OpcoesDeLeitura,
} from "./tipos";

export class ArmazenamentoEmMemoria implements ArmazenamentoDeArquivos {
  private readonly arquivos = new Map<string, Uint8Array>();

  async salvar(chave: string, conteudo: Uint8Array): Promise<void> {
    exigirChaveValida(chave);
    if (this.arquivos.has(chave)) throw new ErroDeArmazenamento("Já existe um arquivo com esta chave.");
    this.arquivos.set(chave, Uint8Array.from(conteudo));
  }

  async ler(chave: string, opcoes: OpcoesDeLeitura = {}): Promise<Uint8Array | null> {
    const conteudo = this.arquivos.get(exigirChaveValida(chave));
    if (!conteudo) return null;
    if (opcoes.limiteBytes !== undefined && conteudo.length > opcoes.limiteBytes) {
      throw new ErroDeArquivoGrandeDemais(opcoes.limiteBytes);
    }
    return Uint8Array.from(conteudo);
  }

  async excluir(chave: string): Promise<void> {
    this.arquivos.delete(exigirChaveValida(chave));
  }

  async existe(chave: string): Promise<boolean> {
    return this.arquivos.has(exigirChaveValida(chave));
  }

  /** Chaves gravadas, para os testes conferirem que não sobraram arquivos órfãos. */
  chaves(): string[] {
    return [...this.arquivos.keys()].sort();
  }
}
