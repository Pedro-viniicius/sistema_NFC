"use client";

// Desenha a primeira página de um PDF em um <canvas>, com o pdf.js. É só uma PRÉVIA para o
// administrador: o arquivo de produção é gerado no servidor e nunca passa por aqui.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { alturaDaCaixa, larguraDaCaixa } from "@/modules/templates/coordenadas";
import type { CaixaPt } from "@/modules/templates/tipos";
import { carregarPdfJs } from "./pdf-no-navegador";

interface Props {
  url: string;
  /** Página visível registrada no servidor: define o tamanho da prévia antes mesmo de o PDF carregar. */
  visao: CaixaPt;
  /** px de CSS por ponto do PDF. */
  escala: number;
  rotulo: string;
  /** Conteúdo sobreposto à página (ex.: o retângulo da área do QR). */
  children?: ReactNode;
}

/** Diferença máxima aceita entre a página que o pdf.js desenha e a registrada no servidor. */
const TOLERANCIA_PT = 0.05;

export function PaginaDoPdf({ url, visao, escala, rotulo, children }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // O resultado guarda a URL a que pertence: ao trocar de URL, o anterior deixa de valer na hora.
  const [carga, setCarga] = useState<{ url: string; pagina?: PDFPageProxy; erro?: string } | null>(null);
  const pagina = carga?.url === url ? (carga.pagina ?? null) : null;
  const erro = carga?.url === url ? (carga.erro ?? null) : null;

  useEffect(() => {
    let cancelado = false;
    let encerrar: (() => void) | undefined;

    carregarPdfJs()
      .then(async (pdfjs) => {
        const tarefa = pdfjs.getDocument({ url, withCredentials: true });
        encerrar = () => void tarefa.destroy();
        const carregada = await (await tarefa.promise).getPage(1);
        if (cancelado) return;
        // As medidas da área do QR partem da página registrada no servidor. Se o pdf.js enxergar
        // outra página, a prévia enganaria o administrador: melhor não mostrar.
        const confere = carregada.view.every((valor, indice) => Math.abs(valor - visao[indice]) <= TOLERANCIA_PT);
        setCarga(
          confere
            ? { url, pagina: carregada }
            : { url, erro: "A prévia não corresponde às medidas registradas deste PDF. Envie o arquivo novamente." },
        );
      })
      .catch(() => {
        if (!cancelado) setCarga({ url, erro: "Não foi possível exibir a prévia do PDF." });
      });

    return () => {
      cancelado = true;
      encerrar?.();
    };
    // `visao` vem do servidor e não muda enquanto a URL for a mesma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const tela = canvas.current;
    if (!pagina || !tela) return;
    // A nitidez acompanha a densidade da tela; o tamanho exibido é definido só pelo CSS.
    const densidade = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = pagina.getViewport({ scale: escala * densidade });
    // Cada desenho usa a sua própria superfície e só então é copiado para a tela: assim uma troca
    // rápida de zoom nunca deixa dois desenhos disputando o mesmo canvas.
    const superficie = document.createElement("canvas");
    superficie.width = Math.max(Math.floor(viewport.width), 1);
    superficie.height = Math.max(Math.floor(viewport.height), 1);
    const contexto = superficie.getContext("2d");
    if (!contexto) return;

    let cancelado = false;
    const tarefa = pagina.render({ canvas: superficie, canvasContext: contexto, viewport });
    tarefa.promise
      .then(() => {
        if (cancelado) return;
        tela.width = superficie.width;
        tela.height = superficie.height;
        tela.getContext("2d")?.drawImage(superficie, 0, 0);
      })
      .catch(() => {
        // Desenho cancelado por uma troca de zoom: o próximo desenho assume.
      });

    return () => {
      cancelado = true;
      tarefa.cancel();
    };
  }, [pagina, escala]);

  const largura = larguraDaCaixa(visao) * escala;
  const altura = alturaDaCaixa(visao) * escala;

  return (
    <div className="relative bg-white shadow-sm ring-1 ring-slate-300" style={{ width: largura, height: altura }}>
      <canvas ref={canvas} role="img" aria-label={rotulo} className="block" style={{ width: largura, height: altura }} />
      {erro ? (
        <p role="alert" className="absolute inset-0 flex items-center justify-center bg-red-50 p-4 text-center text-sm text-red-700">
          {erro}
        </p>
      ) : !pagina ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Carregando a prévia…</p>
      ) : (
        children
      )}
    </div>
  );
}
