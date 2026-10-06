// Nomes de arquivo dos downloads ligados a um template.
import type { TemplateDeImpressao } from "@/db/schema";
import { slugDoNome } from "./formato";

/** Nome seguro para baixar o PDF original do template, ex.: template-google-modelo-01.pdf */
export function formatoDeArquivoDoTemplate(template: Pick<TemplateDeImpressao, "nome">): string {
  return `template-${slugDoNome(template.nome)}.pdf`;
}
