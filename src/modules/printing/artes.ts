// Artes de impressão enviadas pelo painel. Cada modelo (Google, Instagram) pode ter UMA arte
// enviada, que substitui a arte padrão de templates/ junto com a posição do QR e a cor do código.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { artesDeImpressao } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { listarModelos, posicaoDoCodigo, validarModelo, type ModeloDeImpressao } from "./modelos";
import { gerarPdfDoCartao, verificarArteDoModelo } from "./pdf";

/** Tamanho máximo do PDF enviado. O envio passa por uma Server Action, limitada em next.config.ts. */
export const TAMANHO_MAXIMO_DA_ARTE_BYTES = 2 * 1024 * 1024;
/**
 * Tamanho máximo de um cartão já com a arte aplicada. O PDF de um pacote embute a arte uma única vez,
 * então este teto mantém o download do lote abaixo do limite de 4,5 MB por resposta da Vercel.
 */
export const TAMANHO_MAXIMO_DA_ARTE_PROCESSADA_BYTES = 3 * 1024 * 1024;
/** Código fictício usado nas amostras. Não corresponde a nenhum cartão. */
export const CODIGO_DE_AMOSTRA = "AMSTRA";

const medida = (nome: string) =>
  z.coerce
    .number(`Informe ${nome} em milímetros.`)
    .min(0, "As medidas não podem ser negativas.")
    .max(1000, "Medida grande demais.");

export const esquemaDaConfiguracaoDaArte = z.object({
  qrXMm: medida("a distância do QR Code até a borda esquerda"),
  qrYMm: medida("a distância do QR Code até o topo"),
  qrTamanhoMm: medida("o tamanho do QR Code").gt(0, "O tamanho do QR Code deve ser maior que zero."),
  /** null = não imprimir o código do cartão na arte. */
  corDoCodigo: z.enum(["preto", "branco"]).nullable(),
});

export type ConfiguracaoDaArte = z.infer<typeof esquemaDaConfiguracaoDaArte>;

export interface NovaArte extends ConfiguracaoDaArte {
  bytes: Uint8Array;
  nomeDoArquivo: string;
}

function falha(mensagem: string): ErroDeDominio {
  return new ErroDeDominio("IMPRESSAO_INVALIDA", mensagem);
}

function emMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

function nomeParaExibir(nome: string): string {
  const limpo = nome.replace(/[\u0000-\u001f\u007f<>"'`\\/]/g, "").trim().slice(0, 120);
  return limpo.length > 0 ? limpo : "arte.pdf";
}

function comConfiguracao(
  base: ModeloDeImpressao,
  configuracao: ConfiguracaoDaArte,
  arteEnviada: ModeloDeImpressao["arteEnviada"],
): ModeloDeImpressao {
  const qr = { xMm: configuracao.qrXMm, yMm: configuracao.qrYMm, tamanhoMm: configuracao.qrTamanhoMm };
  return {
    ...base,
    arteEnviada,
    qr,
    codigo: configuracao.corDoCodigo ? posicaoDoCodigo(qr, configuracao.corDoCodigo) : null,
  };
}

/** Modelo que vale de fato: o padrão do sistema ou, se houver, a arte enviada com a sua configuração. */
export async function obterModeloEfetivo(db: Banco, base: ModeloDeImpressao): Promise<ModeloDeImpressao> {
  const [arte] = await db.select().from(artesDeImpressao).where(eq(artesDeImpressao.tipo, base.tipo)).limit(1);
  if (!arte) return base;
  return comConfiguracao(base, arte, {
    bytes: new Uint8Array(arte.pdf),
    nomeDoArquivo: arte.nomeDoArquivo,
    enviadaEm: arte.enviadoEm,
  });
}

export interface SituacaoDaArte {
  /** Modelo padrão do sistema, com as medidas e a posição do QR da arte padrão. */
  base: ModeloDeImpressao;
  /** Dados da arte enviada (sem os bytes), ou null quando o modelo usa a arte padrão. */
  enviada: (ConfiguracaoDaArte & { nomeDoArquivo: string; tamanhoBytes: number; enviadoEm: Date }) | null;
}

/** Situação de cada modelo para a tela de artes. Não carrega os PDFs. */
export async function listarSituacaoDasArtes(db: Banco): Promise<SituacaoDaArte[]> {
  const enviadas = await db
    .select({
      tipo: artesDeImpressao.tipo,
      nomeDoArquivo: artesDeImpressao.nomeDoArquivo,
      tamanhoBytes: artesDeImpressao.tamanhoBytes,
      qrXMm: artesDeImpressao.qrXMm,
      qrYMm: artesDeImpressao.qrYMm,
      qrTamanhoMm: artesDeImpressao.qrTamanhoMm,
      corDoCodigo: artesDeImpressao.corDoCodigo,
      enviadoEm: artesDeImpressao.enviadoEm,
    })
    .from(artesDeImpressao);
  return listarModelos().map((base) => ({
    base,
    enviada: enviadas.find((arte) => arte.tipo === base.tipo) ?? null,
  }));
}

export interface ArteSalva {
  modelo: ModeloDeImpressao;
  /** Falso quando o PDF veio no tamanho final, sem sangria. */
  comSangria: boolean;
}

/**
 * Valida e grava a arte de um modelo. Antes de gravar, gera de verdade um cartão de amostra com
 * a nova arte: se o PDF não puder ser usado, nada é salvo e a arte atual continua valendo.
 */
export async function salvarArte(db: Banco, base: ModeloDeImpressao, nova: NovaArte): Promise<ArteSalva> {
  const configuracao = esquemaDaConfiguracaoDaArte.parse(nova);
  const bytes = nova.bytes;

  if (bytes.length === 0) throw falha("Selecione o arquivo PDF da arte.");
  if (bytes.length > TAMANHO_MAXIMO_DA_ARTE_BYTES) {
    throw falha(
      `O arquivo tem ${emMb(bytes.length)} MB. O limite é ${emMb(TAMANHO_MAXIMO_DA_ARTE_BYTES)} MB: ` +
        "exporte o PDF com imagens em resolução menor ou com a arte em vetor.",
    );
  }
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw falha("O arquivo enviado não é um PDF.");
  }

  const modelo = comConfiguracao(base, configuracao, {
    bytes,
    nomeDoArquivo: nomeParaExibir(nova.nomeDoArquivo),
    enviadaEm: new Date(),
  });

  const problemas = validarModelo(modelo);
  if (problemas.length > 0) throw falha(problemas.join(" "));
  const { comSangria } = await verificarArteDoModelo(modelo);

  let amostra: Uint8Array;
  try {
    amostra = await gerarPdfDoCartao(CODIGO_DE_AMOSTRA, modelo);
  } catch (erro) {
    if (erro instanceof ErroDeDominio) throw erro;
    throw falha("Não foi possível usar este PDF como arte. Exporte-o novamente como PDF padrão, sem senha.");
  }
  if (amostra.length > TAMANHO_MAXIMO_DA_ARTE_PROCESSADA_BYTES) {
    throw falha(
      `Depois de processada, a arte fica com ${emMb(amostra.length)} MB por cartão ` +
        `(o limite é ${emMb(TAMANHO_MAXIMO_DA_ARTE_PROCESSADA_BYTES)} MB). Simplifique a arte ou reduza as imagens.`,
    );
  }

  const linha = {
    pdf: bytes,
    nomeDoArquivo: modelo.arteEnviada?.nomeDoArquivo ?? "arte.pdf",
    tamanhoBytes: bytes.length,
    ...configuracao,
    enviadoEm: new Date(),
  };
  await db
    .insert(artesDeImpressao)
    .values({ tipo: base.tipo, ...linha })
    .onConflictDoUpdate({ target: artesDeImpressao.tipo, set: linha });

  return { modelo, comSangria };
}

/** Volta o modelo para a arte padrão do sistema. Devolve falso se não havia arte enviada. */
export async function removerArte(db: Banco, base: ModeloDeImpressao): Promise<boolean> {
  const removidas = await db
    .delete(artesDeImpressao)
    .where(eq(artesDeImpressao.tipo, base.tipo))
    .returning({ tipo: artesDeImpressao.tipo });
  return removidas.length > 0;
}
