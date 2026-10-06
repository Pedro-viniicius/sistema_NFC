// Salva o PDF sem objetos órfãos.
//
// Ao embutir a página da arte, a pdf-lib copia para o documento o conteúdo original da página e
// depois cria, a partir dele, o objeto realmente usado. A cópia original fica sem nenhuma referência,
// mas seria gravada mesmo assim — o arquivo sairia com a arte em dobro. Aqui percorremos tudo o que
// é alcançável a partir da raiz do documento e descartamos o resto antes de salvar.
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "pdf-lib";

export async function salvarSemObjetosOrfaos(documento: PDFDocument): Promise<Uint8Array> {
  // Garante que páginas embutidas e metadados já viraram objetos do documento.
  await documento.flush();

  const { context } = documento;
  const raizes = [context.trailerInfo.Root, context.trailerInfo.Info].filter(
    (objeto): objeto is PDFObject => objeto !== undefined,
  );
  // Sem raiz não há como saber o que é alcançável: salva como está.
  if (raizes.length === 0) return documento.save();

  const alcancados = new Set<string>();
  const pendentes: PDFObject[] = [...raizes];
  for (let objeto = pendentes.pop(); objeto !== undefined; objeto = pendentes.pop()) {
    if (objeto instanceof PDFRef) {
      if (alcancados.has(objeto.tag)) continue;
      alcancados.add(objeto.tag);
      const alvo = context.lookup(objeto);
      if (alvo) pendentes.push(alvo);
    } else if (objeto instanceof PDFStream) {
      pendentes.push(objeto.dict);
    } else if (objeto instanceof PDFDict) {
      for (const valor of objeto.values()) pendentes.push(valor);
    } else if (objeto instanceof PDFArray) {
      for (const item of objeto.asArray()) pendentes.push(item);
    }
  }

  for (const [referencia] of context.enumerateIndirectObjects()) {
    if (!alcancados.has(referencia.tag)) context.delete(referencia);
  }
  return documento.save();
}
