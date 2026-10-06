// Carrega o pdf.js só no navegador e só quando uma prévia é exibida (o painel não paga esse custo antes).
// Usamos a versão "legacy" da biblioteca, que funciona também em navegadores um pouco mais antigos.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let carregamento: Promise<PdfJs> | null = null;

export function carregarPdfJs(): Promise<PdfJs> {
  carregamento ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    // O processamento do PDF roda em um Web Worker, empacotado pelo próprio build do Next.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return carregamento;
}
