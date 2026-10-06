import type { Metadata } from "next";
import { obterBanco } from "@/db/cliente";
import { Painel, TituloDaPagina, classesDoBotao } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { TAMANHO_MAXIMO_DA_ARTE_BYTES, listarSituacaoDasArtes } from "@/modules/printing/artes";
import { BotaoRestaurarArte, FormularioDeEnvioDaArte } from "./formularios";

export const metadata: Metadata = { title: "Artes de impressão — Cartões NFC" };

function tamanhoLegivel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

export default async function PaginaDeArtes() {
  await exigirAdmin();
  const situacoes = await listarSituacaoDasArtes(obterBanco());

  return (
    <>
      <TituloDaPagina titulo="Artes de impressão" />

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm sm:p-6">
        <p className="font-medium text-slate-900">Como preparar o PDF da arte</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            Uma página só, no tamanho exato: <strong>92 × 60 mm</strong> (86 × 54 mm + 3 mm de sangria em cada lado)
            ou <strong>86 × 54 mm</strong> (sem sangria). O sistema não redimensiona a arte.
          </li>
          <li>Exporte sem marcas de corte e sem senha. De preferência com textos em curvas e cores em CMYK.</li>
          <li>Deixe livre a área onde entra o QR Code. A posição e o tamanho dela são informados no envio.</li>
          <li>Tamanho máximo do arquivo: 2 MB.</li>
          <li>
            A arte vale para todos os cartões do modelo, inclusive lotes já criados. Confira sempre a amostra antes de
            mandar arquivos para a gráfica.
          </li>
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {situacoes.map(({ base, enviada }) => {
          const qr = enviada ?? { qrXMm: base.qr.xMm, qrYMm: base.qr.yMm, qrTamanhoMm: base.qr.tamanhoMm };
          const corDoCodigo = enviada ? enviada.corDoCodigo : (base.codigo?.cor ?? null);
          return (
            <Painel key={base.slug} titulo={`Modelo ${base.nome}`}>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Arte em uso</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {enviada ? (
                      <>
                        <span className="break-all">{enviada.nomeDoArquivo}</span>
                        <span className="font-normal text-slate-500">
                          {" · "}
                          {tamanhoLegivel(enviada.tamanhoBytes)} · enviada em {formatarDataHora(enviada.enviadoEm)}
                        </span>
                      </>
                    ) : (
                      "Arte padrão do sistema"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Área do QR Code</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {qr.qrTamanhoMm} × {qr.qrTamanhoMm} mm, a {qr.qrXMm} mm da esquerda e {qr.qrYMm} mm do topo
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-start gap-2">
                <a
                  href={`/admin/artes/${base.slug}/amostra`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classesDoBotao("secundario")}
                >
                  Ver amostra (PDF)
                </a>
                {enviada ? <BotaoRestaurarArte slug={base.slug} nome={base.nome} /> : null}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="mb-3 text-sm font-semibold text-slate-900">
                  {enviada ? "Substituir a arte" : "Enviar arte própria"}
                </p>
                <FormularioDeEnvioDaArte
                  slug={base.slug}
                  tamanhoMaximoBytes={TAMANHO_MAXIMO_DA_ARTE_BYTES}
                  qrXMm={qr.qrXMm}
                  qrYMm={qr.qrYMm}
                  qrTamanhoMm={qr.qrTamanhoMm}
                  corDoCodigo={corDoCodigo}
                />
              </div>
            </Painel>
          );
        })}
      </div>
    </>
  );
}
