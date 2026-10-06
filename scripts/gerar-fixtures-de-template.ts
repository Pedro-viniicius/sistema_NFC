// Gera os PDFs de exemplo usados nos testes dos templates de impressão (tests/fixtures/templates).
// Os arquivos ficam versionados; rode este script só para recriá-los:  pnpm templates:fixtures
//
// O PDF protegido por senha é produzido pelo Ghostscript (`gs`), a partir da arte do Google.
// Sem o Ghostscript instalado, o arquivo já versionado é mantido.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { criarPdfDeTemplate } from "../tests/pdf-de-template";

const PASTA = path.join("tests", "fixtures", "templates");
mkdirSync(PASTA, { recursive: true });

function gravar(nome: string, bytes: Uint8Array): string {
  const destino = path.join(PASTA, nome);
  writeFileSync(destino, bytes);
  console.log(`${destino}  (${bytes.length} bytes)`);
  return destino;
}

const google = criarPdfDeTemplate({ tema: "google" });
const arquivoDoGoogle = gravar("template-google.pdf", google.bytes);
gravar("template-instagram.pdf", criarPdfDeTemplate({ tema: "instagram" }).bytes);

gravar("duas-paginas.pdf", criarPdfDeTemplate({ paginas: 2 }).bytes);
gravar("pagina-rotacionada.pdf", criarPdfDeTemplate({ rotacao: 90 }).bytes);
gravar("mediabox-com-origem.pdf", criarPdfDeTemplate({ origem: [100, 200] }).bytes);
gravar("cropbox-menor.pdf", criarPdfDeTemplate({ origem: [10, 15], margemDaCropBox: 20 }).bytes);
gravar("transformacao-desbalanceada.pdf", criarPdfDeTemplate({ estadoGraficoAberto: true }).bytes);
gravar("com-javascript.pdf", criarPdfDeTemplate({ javascript: true }).bytes);

// Cortado no meio: sem a tabela de objetos e sem o marcador de fim de arquivo.
gravar("truncado.pdf", google.bytes.subarray(0, Math.floor(google.bytes.length * 0.6)));
// Malformado: cabeçalho e fim de PDF, mas sem nenhum objeto legível.
gravar(
  "malformado.pdf",
  new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalogo-quebrado\nstartxref\n9\n%%EOF\n"),
);
// Não é PDF: um texto qualquer com a extensão trocada.
gravar("nao-e-pdf.pdf", new TextEncoder().encode("Isto é um arquivo de texto renomeado para .pdf.\n"));

try {
  const destino = path.join(PASTA, "protegido-por-senha.pdf");
  execFileSync("gs", [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-sDEVICE=pdfwrite",
    "-sOwnerPassword=dono",
    "-sUserPassword=usuario",
    "-dEncryptionR=3",
    "-dKeyLength=128",
    `-sOutputFile=${destino}`,
    arquivoDoGoogle,
  ]);
  console.log(`${destino}  (Ghostscript)`);
} catch {
  console.warn("Ghostscript (gs) não encontrado: protegido-por-senha.pdf não foi recriado.");
}
