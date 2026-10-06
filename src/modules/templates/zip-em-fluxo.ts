// Monta um arquivo ZIP em FLUXO: cada arquivo é produzido, enviado e descartado antes do próximo.
//
// Por que não usar a biblioteca de ZIP do resto do projeto aqui: ela precisa de todos os arquivos na
// memória antes de começar. No pacote da gráfica, cada PDF individual carrega a arte inteira; um
// lote de 100 cartões com uma arte de 2 MB são 200 MB. Em fluxo, a memória usada é a de UM arquivo,
// e o download começa na hora.
//
// O formato é o ZIP clássico (sem ZIP64): até 65.535 arquivos e 4 GB no total, com folga de sobra
// para o limite do pacote. Nomes em UTF-8.
import { crc32, deflateRawSync } from "node:zlib";

export interface EntradaDoZip {
  /** Caminho dentro do ZIP, com "/" entre pastas. */
  nome: string;
  dados: Uint8Array | string;
  /**
   * Comprimir o conteúdo. Vale a pena para texto (CSV, SVG); PDFs com imagens já são comprimidos
   * por dentro, e comprimi-los de novo só gastaria tempo.
   */
  comprimir?: boolean;
}

const LIMITE_DE_TAMANHO = 0xffffffff;
const LIMITE_DE_ARQUIVOS = 0xffff;
const TAMANHO_DO_PEDACO = 256 * 1024;
/** Bit 11 das opções: o nome do arquivo está em UTF-8. */
const NOMES_EM_UTF8 = 0x0800;

interface Registro {
  nome: Buffer;
  metodo: number;
  crc: number;
  comprimido: number;
  original: number;
  posicao: number;
}

/** Data e hora no formato do ZIP (o do MS-DOS), no horário de Brasília. */
function dataDoZip(agora: Date): { hora: number; data: number } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(agora)
      .map((parte) => [parte.type, Number(parte.value)]),
  );
  return {
    hora: ((partes.hour % 24) << 11) | (partes.minute << 5) | (partes.second >> 1),
    data: ((partes.year - 1980) << 9) | (partes.month << 5) | partes.day,
  };
}

function cabecalhoLocal(registro: Registro, momento: { hora: number; data: number }): Buffer {
  const cabecalho = Buffer.alloc(30);
  cabecalho.writeUInt32LE(0x04034b50, 0);
  cabecalho.writeUInt16LE(20, 4); // versão necessária para extrair
  cabecalho.writeUInt16LE(NOMES_EM_UTF8, 6);
  cabecalho.writeUInt16LE(registro.metodo, 8);
  cabecalho.writeUInt16LE(momento.hora, 10);
  cabecalho.writeUInt16LE(momento.data, 12);
  cabecalho.writeUInt32LE(registro.crc, 14);
  cabecalho.writeUInt32LE(registro.comprimido, 18);
  cabecalho.writeUInt32LE(registro.original, 22);
  cabecalho.writeUInt16LE(registro.nome.length, 26);
  cabecalho.writeUInt16LE(0, 28);
  return Buffer.concat([cabecalho, registro.nome]);
}

function entradaDoDiretorio(registro: Registro, momento: { hora: number; data: number }): Buffer {
  const entrada = Buffer.alloc(46);
  entrada.writeUInt32LE(0x02014b50, 0);
  entrada.writeUInt16LE(20, 4); // feito por
  entrada.writeUInt16LE(20, 6); // versão necessária
  entrada.writeUInt16LE(NOMES_EM_UTF8, 8);
  entrada.writeUInt16LE(registro.metodo, 10);
  entrada.writeUInt16LE(momento.hora, 12);
  entrada.writeUInt16LE(momento.data, 14);
  entrada.writeUInt32LE(registro.crc, 16);
  entrada.writeUInt32LE(registro.comprimido, 20);
  entrada.writeUInt32LE(registro.original, 24);
  entrada.writeUInt16LE(registro.nome.length, 28);
  // 30: extra, 32: comentário, 34: disco, 36: atributos internos, 38: atributos externos — todos zero.
  entrada.writeUInt32LE(registro.posicao, 42);
  return Buffer.concat([entrada, registro.nome]);
}

function fimDoDiretorio(quantidade: number, tamanho: number, posicao: number): Buffer {
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(quantidade, 8);
  fim.writeUInt16LE(quantidade, 10);
  fim.writeUInt32LE(tamanho, 12);
  fim.writeUInt32LE(posicao, 16);
  return fim;
}

function nomeValido(nome: string): boolean {
  return (
    nome.length > 0 &&
    !nome.startsWith("/") &&
    !nome.includes("\\") &&
    !nome.split("/").some((parte) => parte === "" || parte === "." || parte === "..")
  );
}

/**
 * Devolve o ZIP como um fluxo de bytes. As entradas são pedidas uma a uma, só quando o leitor do
 * fluxo está pronto para recebê-las: se o download for lento, a geração espera.
 */
export function zipEmFluxo(
  entradas: AsyncIterable<EntradaDoZip> | Iterable<EntradaDoZip>,
  agora: Date = new Date(),
): ReadableStream<Uint8Array> {
  const momento = dataDoZip(agora);
  const registros: Registro[] = [];
  const nomes = new Set<string>();
  let posicao = 0;

  async function* bytes(): AsyncGenerator<Uint8Array> {
    for await (const entrada of entradas) {
      if (!nomeValido(entrada.nome) || nomes.has(entrada.nome)) {
        throw new Error(`Nome de arquivo inválido ou repetido no ZIP: ${entrada.nome}`);
      }
      nomes.add(entrada.nome);
      if (registros.length >= LIMITE_DE_ARQUIVOS) throw new Error("O ZIP teria arquivos demais.");

      const original = typeof entrada.dados === "string" ? Buffer.from(entrada.dados, "utf8") : entrada.dados;
      const conteudo = entrada.comprimir ? deflateRawSync(original) : original;
      const registro: Registro = {
        nome: Buffer.from(entrada.nome, "utf8"),
        metodo: entrada.comprimir ? 8 : 0,
        crc: crc32(original),
        comprimido: conteudo.length,
        original: original.length,
        posicao,
      };
      const cabecalho = cabecalhoLocal(registro, momento);
      if (posicao + cabecalho.length + conteudo.length > LIMITE_DE_TAMANHO) {
        throw new Error("O ZIP passaria de 4 GB.");
      }
      registros.push(registro);

      yield cabecalho;
      for (let inicio = 0; inicio < conteudo.length; inicio += TAMANHO_DO_PEDACO) {
        yield conteudo.subarray(inicio, inicio + TAMANHO_DO_PEDACO);
      }
      posicao += cabecalho.length + conteudo.length;
    }

    const diretorio = Buffer.concat(registros.map((registro) => entradaDoDiretorio(registro, momento)));
    yield diretorio;
    yield fimDoDiretorio(registros.length, diretorio.length, posicao);
  }

  const gerador = bytes();
  return new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        const { done, value } = await gerador.next();
        if (done) controlador.close();
        else controlador.enqueue(value);
      } catch (erro) {
        controlador.error(erro);
      }
    },
    async cancel() {
      // Download interrompido: para de gerar arquivos.
      await gerador.return(undefined);
    },
  });
}

/** Junta um fluxo inteiro na memória. Para testes e para arquivos pequenos. */
export async function juntarFluxo(fluxo: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const pedacos: Uint8Array[] = [];
  let total = 0;
  const leitor = fluxo.getReader();
  for (let leitura = await leitor.read(); !leitura.done; leitura = await leitor.read()) {
    pedacos.push(leitura.value);
    total += leitura.value.length;
  }
  const tudo = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    tudo.set(pedaco, posicao);
    posicao += pedaco.length;
  }
  return tudo;
}
