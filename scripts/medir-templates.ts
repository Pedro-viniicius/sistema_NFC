// Mede tempo, memória e tamanho da geração de PDFs com template:  pnpm templates:medir
// Os números de docs/templates-impressao.md vêm deste script (Node 22, máquina de desenvolvimento).
import { renderTemplatePdf } from "../src/modules/templates/renderizacao";
import { criarPdfDeTemplate } from "../tests/pdf-de-template";

process.env.NEXT_PUBLIC_APP_URL ??= "https://go.example.com";

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function urls(quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => {
    let codigo = "";
    for (let posicao = 0, resto = i * 7919 + 13; posicao < 6; posicao++) {
      codigo += ALFABETO[resto % ALFABETO.length];
      resto = Math.floor(resto / ALFABETO.length) + posicao * 5;
    }
    return `https://sistema-nfc-topaz.vercel.app/c/${codigo}`;
  });
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function medir(pesoDoTemplateMb: number, cartoes: number): Promise<void> {
  const template = criarPdfDeTemplate({ pesoExtraBytes: Math.round(pesoDoTemplateMb * 1024 * 1024) });
  const lista = urls(cartoes);
  global.gc?.();
  const memoriaAntes = process.memoryUsage().rss;
  const inicio = performance.now();
  const saida = await renderTemplatePdf(template.bytes, { area: template.areaDoQr, zonaDeSilencioModulos: 4 }, lista);
  const tempo = performance.now() - inicio;
  const pico = process.memoryUsage().rss;
  console.log(
    [
      `template ${mb(template.bytes.length).padStart(9)}`,
      `${String(cartoes).padStart(4)} cartões`,
      `${tempo.toFixed(0).padStart(5)} ms`,
      `PDF ${mb(saida.length).padStart(9)}`,
      `${((saida.length - template.bytes.length) / cartoes).toFixed(0).padStart(5)} bytes/página`,
      `memória +${mb(Math.max(pico - memoriaAntes, 0))} (RSS ${mb(pico)})`,
    ].join(" | "),
  );
}

async function principal(): Promise<void> {
  for (const peso of [0, 5, 25 - 0.01]) {
    for (const cartoes of [1, 100, 1000]) await medir(peso, cartoes);
  }
}

void principal();
