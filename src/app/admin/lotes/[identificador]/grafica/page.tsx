import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { Painel, classesDoBotao } from "@/components/ui";
import { ErroDeConfiguracao } from "@/lib/env";
import { ErroDeDominio } from "@/lib/erros";
import { exigirAdmin } from "@/modules/auth/sessao";
import { STATUS_CARTAO, type StatusCartao } from "@/modules/cards/tipos";
import { obterModeloEfetivo } from "@/modules/printing/artes";
import { listarModelos, obterModeloPorSlug } from "@/modules/printing/modelos";
import {
  MAXIMO_DE_CARTOES_POR_PACOTE,
  sugerirModelo,
  totalDePartes,
  type PacoteDeProducao,
} from "@/modules/printing/producao";
import { carregarLoteParaProducao, planejarPacoteDoLote } from "@/modules/printing/servico";
import { PreviaDoModelo } from "./previa";

export const metadata: Metadata = { title: "Arquivos para a gráfica — Cartões NFC" };

const STATUS_NO_RESUMO: Record<StatusCartao, [singular: string, plural: string]> = {
  NAO_CONFIGURADO: ["não configurado", "não configurados"],
  ATIVO: ["ativo", "ativos"],
  INATIVO: ["inativo", "inativos"],
};

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default async function PaginaDeArquivosParaGrafica({
  params,
  searchParams,
}: PageProps<"/admin/lotes/[identificador]/grafica">) {
  await exigirAdmin();
  const { identificador } = await params;
  const modeloPedido = (await searchParams).modelo;
  const slugPedido = Array.isArray(modeloPedido) ? modeloPedido[0] : modeloPedido;

  const db = obterBanco();
  const dados = await carregarLoteParaProducao(db, identificador).catch((erro: unknown) => {
    if (erro instanceof ErroDeDominio) return null;
    throw erro;
  });
  if (!dados) notFound();
  const { lote, cartoes } = dados;

  const modeloBase = obterModeloPorSlug(slugPedido) ?? sugerirModelo(lote.tipo);
  // Já com a arte enviada pelo painel (e a posição do QR dela), se houver.
  const modelo = modeloBase ? await obterModeloEfetivo(db, modeloBase) : null;
  const partes = totalDePartes(cartoes.length);
  const base = `/admin/lotes/${lote.identificador}/grafica`;

  // Planeja (e portanto valida) todas as partes antes de oferecer qualquer download.
  let pacotes: PacoteDeProducao[] = [];
  let problema: string | null = null;
  if (modelo) {
    try {
      pacotes = await Promise.all(
        Array.from({ length: partes }, (_, indice) => planejarPacoteDoLote(dados, modelo, indice + 1)),
      );
    } catch (erro) {
      if (!(erro instanceof ErroDeDominio) && !(erro instanceof ErroDeConfiguracao)) throw erro;
      problema = erro.message;
    }
  }

  const porStatus = STATUS_CARTAO.map((status) => ({
    status,
    quantidade: cartoes.filter((cartao) => cartao.status === status).length,
  })).filter((item) => item.quantidade > 0);

  const linkDoArquivo = (pacote: PacoteDeProducao, arquivo: "pdf" | "csv" | "zip") =>
    `${base}/baixar?arquivo=${arquivo}&modelo=${pacote.modelo.slug}&parte=${pacote.parte}`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href={`/admin/lotes/${lote.identificador}`} className="text-slate-500 hover:text-slate-900">
          ← {lote.identificador}
        </Link>
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Arquivos para a gráfica</h1>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Painel titulo="Lote">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Dado rotulo="Lote">
                <span className="font-mono">{lote.identificador}</span>
              </Dado>
              <Dado rotulo="Quantidade de cartões">{cartoes.length.toLocaleString("pt-BR")}</Dado>
              <Dado rotulo="Status do lote">
                {porStatus.length > 0
                  ? porStatus
                      .map((item) => `${item.quantidade} ${STATUS_NO_RESUMO[item.status][item.quantidade === 1 ? 0 : 1]}`)
                      .join(" · ")
                  : "—"}
              </Dado>
            </dl>

            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="mb-2 text-sm font-medium text-slate-700">Modelo</p>
              <div className="flex flex-wrap gap-2">
                {listarModelos().map((opcao) => (
                  <Link
                    key={opcao.slug}
                    href={`${base}?modelo=${opcao.slug}`}
                    aria-current={modelo?.slug === opcao.slug ? "true" : undefined}
                    className={
                      modelo?.slug === opcao.slug
                        ? "rounded-lg border-2 border-slate-900 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white"
                        : "rounded-lg border-2 border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"
                    }
                  >
                    {opcao.nome}
                  </Link>
                ))}
              </div>
              {modelo ? (
                <p className="mt-3 text-sm text-slate-600">
                  Adesivo de {modelo.larguraFinalMm} × {modelo.alturaFinalMm} mm com {modelo.sangriaMm} mm de sangria
                  (arte de {modelo.larguraFinalMm + 2 * modelo.sangriaMm} ×{" "}
                  {modelo.alturaFinalMm + 2 * modelo.sangriaMm} mm). QR Code de {modelo.qr.tamanhoMm} mm.{" "}
                  {modelo.arteEnviada ? `Arte enviada: ${modelo.arteEnviada.nomeDoArquivo}.` : "Arte padrão do sistema."}{" "}
                  <Link href="/admin/artes" className="underline underline-offset-2 hover:text-slate-900">
                    Trocar arte
                  </Link>
                </p>
              ) : (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Este lote não tem um tipo com arte de impressão. Escolha o modelo acima.
                </p>
              )}
            </div>
          </Painel>

          {problema ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <p className="font-semibold">Não é possível gerar os arquivos deste lote.</p>
              <p className="mt-1">{problema}</p>
            </div>
          ) : null}

          {pacotes.length > 0 ? (
            <Painel
              titulo="Downloads"
              descricao={
                partes > 1
                  ? `Este lote foi dividido em ${partes} partes de até ${MAXIMO_DE_CARTOES_POR_PACOTE} cartões. Baixe todas.`
                  : "O ZIP completo já inclui o PDF do lote, o CSV e os QR Codes em SVG, além dos PDFs individuais quando o tamanho da arte permite."
              }
            >
              <ul className="divide-y divide-slate-100">
                {pacotes.map((pacote) => (
                  <li key={pacote.parte} className="py-4 first:pt-0 last:pb-0">
                    <p className="mb-3 text-sm text-slate-600">
                      <span className="font-mono font-semibold text-slate-900">{pacote.nome}</span>
                      {" · "}
                      {pacote.itens.length} {pacote.itens.length === 1 ? "cartão" : "cartões"}
                      {partes > 1
                        ? ` (números ${pacote.itens[0].numero} a ${pacote.itens[pacote.itens.length - 1].numero})`
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <a href={linkDoArquivo(pacote, "zip")} className={classesDoBotao("primario")}>
                        Baixar ZIP completo
                      </a>
                      <a href={linkDoArquivo(pacote, "pdf")} className={classesDoBotao("secundario")}>
                        Baixar PDF do lote
                      </a>
                      <a href={linkDoArquivo(pacote, "csv")} className={classesDoBotao("secundario")}>
                        Baixar CSV
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </Painel>
          ) : null}

          <Painel titulo="Antes de enviar à gráfica">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
              <li>Cada página do PDF é um cartão diferente: o QR Code muda de uma página para outra.</li>
              <li>
                O QR Code e o chip NFC de cada cartão recebem a mesma URL permanente, listada no{" "}
                <code className="font-mono">controle.csv</code> (colunas <code className="font-mono">url_qr</code> e{" "}
                <code className="font-mono">url_nfc</code>).
              </li>
              <li>O código impresso abaixo do QR identifica o cartão na hora de gravar o NFC.</li>
              <li>
                Os arquivos são PDFs vetoriais em CMYK, com corte e sangria marcados, mas não são PDF/X certificados.
                Se a gráfica exigir PDF/X ou perfil de cor específico, é preciso uma etapa de pré-impressão.
              </li>
            </ul>
          </Painel>
        </div>

        <div className="space-y-4">
          {modelo && pacotes.length > 0 ? (
            <Painel titulo="Prévia">
              <PreviaDoModelo modelo={modelo} codigo={pacotes[0].itens[0].codigo} />
              <a
                href={`/admin/cartoes/${pacotes[0].itens[0].codigo}/impressao?modelo=${modelo.slug}&ver=1`}
                target="_blank"
                rel="noopener noreferrer"
                className={classesDoBotao("secundario", "mt-4 w-full")}
              >
                Abrir PDF do primeiro cartão
              </a>
            </Painel>
          ) : null}
        </div>
      </div>
    </>
  );
}
