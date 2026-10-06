// Prévia esquemática da arte: mostra as medidas, a linha de corte e a posição do QR e do código.
// Não é a fonte de verdade da impressão — o PDF é. A arte fixa só aparece no PDF.
import type { ModeloDeImpressao } from "@/modules/printing/modelos";

export function PreviaDoModelo({ modelo, codigo }: { modelo: ModeloDeImpressao; codigo: string }) {
  const { larguraFinalMm, alturaFinalMm, sangriaMm, qr } = modelo;
  const largura = larguraFinalMm + 2 * sangriaMm;
  const altura = alturaFinalMm + 2 * sangriaMm;

  return (
    <figure>
      {/* Unidade do viewBox: milímetro, com origem no canto da arte (incluindo a sangria). */}
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        role="img"
        aria-label={`Prévia esquemática do modelo ${modelo.nome}`}
        className="w-full rounded-lg border border-slate-200"
      >
        <rect width={largura} height={altura} fill="#e2e8f0" />
        <rect
          x={sangriaMm}
          y={sangriaMm}
          width={larguraFinalMm}
          height={alturaFinalMm}
          fill="#ffffff"
          stroke="#64748b"
          strokeWidth={0.25}
          strokeDasharray="1.2 0.8"
        />
        <text x={sangriaMm + 4} y={sangriaMm + 9} fontSize={4} fill="#94a3b8">
          Arte fixa
        </text>
        <text x={sangriaMm + 4} y={sangriaMm + 13.5} fontSize={2.4} fill="#94a3b8">
          Modelo {modelo.nome} · visível no PDF
        </text>
        <rect
          x={sangriaMm + qr.xMm}
          y={sangriaMm + qr.yMm}
          width={qr.tamanhoMm}
          height={qr.tamanhoMm}
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth={0.2}
        />
        <image
          href={`/admin/cartoes/${codigo}/qr`}
          x={sangriaMm + qr.xMm}
          y={sangriaMm + qr.yMm}
          width={qr.tamanhoMm}
          height={qr.tamanhoMm}
        />
        {modelo.codigo ? (
          <text
            x={sangriaMm + modelo.codigo.xCentroMm}
            y={sangriaMm + modelo.codigo.linhaDeBaseMm}
            fontSize={2.4}
            fontWeight={700}
            letterSpacing={0.25}
            textAnchor="middle"
            fill="#0f172a"
          >
            {codigo}
          </text>
        ) : null}
      </svg>
      <figcaption className="mt-2 text-xs text-slate-500">
        Prévia esquemática com o QR do primeiro cartão. Área cinza: sangria de {sangriaMm} mm. Linha tracejada:
        corte ({larguraFinalMm} × {alturaFinalMm} mm). A arte completa está no PDF.
      </figcaption>
    </figure>
  );
}
