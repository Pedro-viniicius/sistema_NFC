// Leitura das fixtures versionadas em tests/fixtures/templates.
import { readFileSync } from "node:fs";
import path from "node:path";

export type NomeDaFixture =
  | "template-google"
  | "template-instagram"
  | "duas-paginas"
  | "pagina-rotacionada"
  | "mediabox-com-origem"
  | "cropbox-menor"
  | "transformacao-desbalanceada"
  | "com-javascript"
  | "truncado"
  | "malformado"
  | "nao-e-pdf"
  | "protegido-por-senha";

export function lerFixture(nome: NomeDaFixture): Uint8Array {
  return new Uint8Array(readFileSync(path.join("tests", "fixtures", "templates", `${nome}.pdf`)));
}
