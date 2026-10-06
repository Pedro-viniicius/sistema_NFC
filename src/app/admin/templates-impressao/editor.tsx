"use client";

// Editor da área do QR sobre a prévia do PDF.
//
// A posição é guardada SEMPRE em pontos do PDF (origem embaixo, à esquerda). Pixels, zoom e
// densidade de tela existem só aqui, no desenho: toda conversão passa por
// src/modules/templates/coordenadas.ts, a mesma usada (e testada) no servidor.
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as EventoDePonteiro } from "react";
import { classesDoBotao, classesDoCampo } from "@/components/ui";
import {
  LADO_MINIMO_DA_AREA_DO_QR_MM,
  alturaDaCaixa,
  areaAPartirDeMm,
  areaParaMm,
  larguraDaCaixa,
  limitarAreaAPagina,
  mmToPt,
  pdfToPreviewCoordinates,
  previewToPdfCoordinates,
  validateQrArea,
  type AreaEmMm,
  type RetanguloNaPrevia,
} from "@/modules/templates/coordenadas";
import { formatarMm, lerNumero } from "@/modules/templates/formato";
import { medidasDoQr, quadradoDoQr } from "@/modules/templates/geometria-do-qr";
import {
  ZONA_DE_SILENCIO_MAXIMA,
  ZONA_DE_SILENCIO_MINIMA,
  type CaixaPt,
  type RetanguloPt,
} from "@/modules/templates/tipos";
import { ativarTemplateAction, salvarAreaDoQrAction, testarQrAction } from "./acoes";

// O pdf.js só é carregado no navegador, e só quando a prévia aparece.
const PaginaDoPdf = dynamic(() => import("./pagina-do-pdf").then((modulo) => modulo.PaginaDoPdf), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-slate-500">Carregando a prévia…</p>,
});

/** Zoom de 100% = tamanho real na tela: 96 px de CSS por polegada, 72 pontos por polegada. */
const CSS_POR_PONTO = 96 / 72;
const ZOOMS = [
  { valor: 0.5, rotulo: "50%" },
  { valor: 1, rotulo: "100%" },
  { valor: 1.5, rotulo: "150%" },
] as const;
type Zoom = (typeof ZOOMS)[number]["valor"] | "ajustar";

type Canto = "no" | "ne" | "so" | "se";
const CANTOS: { canto: Canto; classes: string; cursor: string }[] = [
  { canto: "no", classes: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { canto: "ne", classes: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { canto: "so", classes: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
  { canto: "se", classes: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
];

interface Arrasto {
  modo: "mover" | Canto;
  x: number;
  y: number;
  inicial: RetanguloNaPrevia;
}

export interface TemplateNoEditor {
  id: string;
  nome: string;
  status: "RASCUNHO" | "PRONTO" | "INATIVO";
  temProduto: boolean;
  padrao: boolean;
  /** Página visível do PDF, em pontos. */
  visao: CaixaPt;
  /** Área gravada no servidor, ou null se ainda não foi configurada. */
  area: RetanguloPt | null;
  zonaDeSilencioModulos: number;
  /** Bloqueado = já usado por um lote: só leitura. */
  bloqueado: boolean;
  /** O teste do QR vale para a configuração gravada. */
  testado: boolean;
}

interface Props {
  template: TemplateNoEditor;
  /** Módulos por lado do QR de uma URL permanente deste sistema. */
  modulosPorLado: number;
}

const limitar = (valor: number, minimo: number, maximo: number) => Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));

function mesmaArea(a: RetanguloPt | null, b: RetanguloPt | null): boolean {
  if (!a || !b) return a === b;
  return (["x", "y", "largura", "altura"] as const).every((campo) => Math.abs(a[campo] - b[campo]) < 1e-6);
}

/** Área inicial sugerida: um quadrado no centro da página. */
function areaSugerida(visao: CaixaPt): RetanguloPt {
  const lado = Math.max(Math.min(larguraDaCaixa(visao), alturaDaCaixa(visao)) * 0.4, mmToPt(LADO_MINIMO_DA_AREA_DO_QR_MM));
  return limitarAreaAPagina(
    {
      x: visao[0] + (larguraDaCaixa(visao) - lado) / 2,
      y: visao[1] + (alturaDaCaixa(visao) - lado) / 2,
      largura: lado,
      altura: lado,
    },
    visao,
  );
}

function CampoEmMm({
  rotulo,
  valor,
  desabilitado,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  desabilitado: boolean;
  aoMudar: (valor: number) => void;
}) {
  // Enquanto o campo está em edição, mostra o que foi digitado; fora disso, o valor formatado.
  const [texto, setTexto] = useState<string | null>(null);
  const invalido = texto !== null && lerNumero(texto) === null;
  return (
    <label className="block text-sm text-slate-600">
      {rotulo}
      <span className="relative mt-1 block">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={desabilitado}
          aria-invalid={invalido}
          value={texto ?? formatarMm(valor)}
          onFocus={(evento) => evento.target.select()}
          onChange={(evento) => {
            setTexto(evento.target.value);
            const numero = lerNumero(evento.target.value);
            if (numero !== null) aoMudar(numero);
          }}
          onBlur={() => setTexto(null)}
          className={classesDoCampo(`pr-10 tabular-nums ${invalido ? "border-red-400" : ""}`)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">mm</span>
      </span>
    </label>
  );
}

export function EditorDoQr({ template, modulosPorLado }: Props) {
  const { visao, bloqueado } = template;
  const [area, setArea] = useState<RetanguloPt | null>(template.area);
  const [zona, setZona] = useState(template.zonaDeSilencioModulos);
  const [proporcaoTravada, setProporcaoTravada] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("ajustar");
  const [larguraDisponivel, setLarguraDisponivel] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [definirComoPadrao, setDefinirComoPadrao] = useState(false);
  /** Versão da prévia de teste exibida (muda a URL para o navegador buscar o PDF de novo). */
  const [previaDeTeste, setPreviaDeTeste] = useState<number | null>(null);
  const [pendente, iniciar] = useTransition();
  const moldura = useRef<HTMLDivElement>(null);
  const arrasto = useRef<Arrasto | null>(null);

  // Quando o servidor devolve uma nova configuração gravada (depois de salvar), ela passa a valer.
  const [gravada, setGravada] = useState({ area: template.area, zona: template.zonaDeSilencioModulos });
  if (!mesmaArea(gravada.area, template.area) || gravada.zona !== template.zonaDeSilencioModulos) {
    setGravada({ area: template.area, zona: template.zonaDeSilencioModulos });
    setArea(template.area);
    setZona(template.zonaDeSilencioModulos);
  }

  useEffect(() => {
    const elemento = moldura.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => setLarguraDisponivel(entrada.contentRect.width));
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const larguraDaPagina = larguraDaCaixa(visao);
  /** px de CSS por ponto do PDF, no zoom escolhido. */
  const escala =
    zoom === "ajustar"
      ? larguraDisponivel > 0
        ? Math.max((larguraDisponivel - 2) / larguraDaPagina, 0.1)
        : CSS_POR_PONTO
      : CSS_POR_PONTO * zoom;
  const previa = useMemo(() => ({ visao, larguraCss: larguraDaPagina * escala }), [visao, larguraDaPagina, escala]);
  const alturaCss = alturaDaCaixa(visao) * escala;

  const alterado = !mesmaArea(area, template.area) || zona !== template.zonaDeSilencioModulos;
  const problemas = area ? validateQrArea(area, visao) : [];
  const medidas = area ? medidasDoQr({ area, zonaDeSilencioModulos: zona }, modulosPorLado) : null;
  const emMm = area ? areaParaMm(area, visao) : null;
  const naTela = area ? pdfToPreviewCoordinates(area, previa) : null;
  const quadrado = area ? quadradoDoQr({ area, zonaDeSilencioModulos: zona }, modulosPorLado) : null;
  const quadradoNaTela = quadrado
    ? pdfToPreviewCoordinates({ x: quadrado.x, y: quadrado.y, largura: quadrado.lado, altura: quadrado.lado }, previa)
    : null;
  const testadoEAtual = template.testado && !alterado;
  const podeAtivar = testadoEAtual && template.temProduto && template.status !== "PRONTO";

  function mudarArea(nova: RetanguloPt): void {
    setArea(nova);
    setErro(null);
    setAviso(null);
  }

  function iniciarArrasto(evento: EventoDePonteiro<HTMLElement>, modo: Arrasto["modo"]): void {
    if (bloqueado || !naTela) return;
    evento.preventDefault();
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasto.current = { modo, x: evento.clientX, y: evento.clientY, inicial: naTela };
  }

  function arrastar(evento: EventoDePonteiro<HTMLElement>): void {
    const atual = arrasto.current;
    if (!atual) return;
    const dx = evento.clientX - atual.x;
    const dy = evento.clientY - atual.y;
    const { esquerda: e0, topo: t0, largura: l0, altura: a0 } = atual.inicial;
    const minimo = mmToPt(LADO_MINIMO_DA_AREA_DO_QR_MM) * escala;
    let novo: RetanguloNaPrevia;

    if (atual.modo === "mover") {
      novo = {
        esquerda: limitar(e0 + dx, 0, previa.larguraCss - l0),
        topo: limitar(t0 + dy, 0, alturaCss - a0),
        largura: l0,
        altura: a0,
      };
    } else {
      // O canto oposto fica parado; o canto arrastado segue o ponteiro, sem sair da página.
      const paraDireita = atual.modo === "ne" || atual.modo === "se";
      const paraBaixo = atual.modo === "so" || atual.modo === "se";
      const larguraMaxima = paraDireita ? previa.larguraCss - e0 : e0 + l0;
      const alturaMaxima = paraBaixo ? alturaCss - t0 : t0 + a0;
      let largura = l0 + (paraDireita ? dx : -dx);
      let altura = a0 + (paraBaixo ? dy : -dy);
      if (proporcaoTravada) {
        const fator = limitar(
          Math.max(largura / l0, altura / a0),
          minimo / Math.min(l0, a0),
          Math.min(larguraMaxima / l0, alturaMaxima / a0),
        );
        largura = l0 * fator;
        altura = a0 * fator;
      } else {
        largura = limitar(largura, minimo, larguraMaxima);
        altura = limitar(altura, minimo, alturaMaxima);
      }
      novo = {
        esquerda: paraDireita ? e0 : e0 + l0 - largura,
        topo: paraBaixo ? t0 : t0 + a0 - altura,
        largura,
        altura,
      };
    }
    mudarArea(previewToPdfCoordinates(novo, previa));
  }

  function terminarArrasto(evento: EventoDePonteiro<HTMLElement>): void {
    if (!arrasto.current) return;
    arrasto.current = null;
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
  }

  function moverComTeclado(evento: React.KeyboardEvent): void {
    if (bloqueado || !area) return;
    const passo = mmToPt(evento.shiftKey ? 0.1 : 1);
    const deslocamento: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0],
      ArrowRight: [passo, 0],
      ArrowUp: [0, passo],
      ArrowDown: [0, -passo],
    };
    const [dx, dy] = deslocamento[evento.key] ?? [0, 0];
    if (dx === 0 && dy === 0) return;
    evento.preventDefault();
    mudarArea(limitarAreaAPagina({ ...area, x: area.x + dx, y: area.y + dy }, visao));
  }

  function mudarMedida(campo: keyof AreaEmMm, valor: number): void {
    if (!area || !emMm) return;
    const novas: AreaEmMm = { ...emMm, [campo]: valor };
    // Com a proporção travada, largura e altura mudam juntas.
    if (proporcaoTravada && emMm.larguraMm > 0 && emMm.alturaMm > 0) {
      if (campo === "larguraMm") novas.alturaMm = (valor * emMm.alturaMm) / emMm.larguraMm;
      if (campo === "alturaMm") novas.larguraMm = (valor * emMm.larguraMm) / emMm.alturaMm;
    }
    mudarArea(areaAPartirDeMm(novas, visao));
  }

  async function salvar(): Promise<boolean> {
    if (!area) return false;
    const resultado = await salvarAreaDoQrAction(template.id, { area, zonaDeSilencioModulos: zona });
    if (!resultado.ok) {
      setErro(resultado.erro);
      return false;
    }
    return true;
  }

  function aoSalvar(): void {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      if (await salvar()) {
        setPreviaDeTeste(null);
        setAviso("Área do QR Code salva. Faça o teste para liberar a ativação.");
      }
    });
  }

  function aoTestar(): void {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      if (alterado && !(await salvar())) return;
      const resultado = await testarQrAction(template.id);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setPreviaDeTeste(Date.now());
      setAviso("Teste concluído: o PDF final foi gerado com o QR Code de teste. Confira a prévia abaixo.");
    });
  }

  function aoAtivar(): void {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const resultado = await ativarTemplateAction(template.id, { definirComoPadrao });
      if (!resultado.ok) setErro(resultado.erro);
      else setAviso("Template ativado: já pode ser usado em novos lotes.");
    });
  }

  const urlDoTeste = `/admin/templates-impressao/${template.id}/teste`;

  return (
    <div className="space-y-5">
      {/* Em telas pequenas, arrastar com precisão de décimos de milímetro não é confiável. */}
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 md:hidden">
        A configuração precisa da área do QR é recomendada em uma tela maior.
      </p>

      {bloqueado ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Este template já foi usado em um lote: a área do QR Code está travada. Para mudar a arte ou a posição, use{" "}
          <strong>Duplicar como nova versão</strong>.
        </p>
      ) : null}

      <div className="hidden gap-5 md:grid lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Zoom:</span>
            {ZOOMS.map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                aria-pressed={zoom === opcao.valor}
                onClick={() => setZoom(opcao.valor)}
                className={`rounded-md border px-2.5 py-1 font-medium ${zoom === opcao.valor ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {opcao.rotulo}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={zoom === "ajustar"}
              onClick={() => setZoom("ajustar")}
              className={`rounded-md border px-2.5 py-1 font-medium ${zoom === "ajustar" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              Ajustar à tela
            </button>
          </div>

          <div ref={moldura} className="max-h-[75vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100">
            <div className="w-max">
              <PaginaDoPdf
                url={`/admin/templates-impressao/${template.id}/arquivo`}
                visao={visao}
                escala={escala}
                rotulo={`Prévia do template ${template.nome}`}
              >
                {naTela ? (
                  <div
                    role="group"
                    aria-label="Área do QR Code"
                    tabIndex={bloqueado ? -1 : 0}
                    data-testid="area-do-qr"
                    onPointerDown={(evento) => iniciarArrasto(evento, "mover")}
                    onPointerMove={arrastar}
                    onPointerUp={terminarArrasto}
                    onPointerCancel={terminarArrasto}
                    onKeyDown={moverComTeclado}
                    className={`absolute touch-none select-none border-2 border-dashed outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${problemas.length > 0 ? "border-red-500 bg-red-500/10" : "border-sky-600 bg-sky-500/10"} ${bloqueado ? "cursor-default" : "cursor-move"}`}
                    style={{ left: naTela.esquerda, top: naTela.topo, width: naTela.largura, height: naTela.altura }}
                  >
                    <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t bg-sky-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                      Área do QR Code
                    </span>
                    {/* O QR ocupa o maior quadrado que cabe na área, centralizado. */}
                    {quadradoNaTela ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute border border-sky-700/70 bg-white/60"
                        style={{
                          left: quadradoNaTela.esquerda - naTela.esquerda,
                          top: quadradoNaTela.topo - naTela.topo,
                          width: quadradoNaTela.largura,
                          height: quadradoNaTela.altura,
                        }}
                      />
                    ) : null}
                    {bloqueado
                      ? null
                      : CANTOS.map(({ canto, classes, cursor }) => (
                          <span
                            key={canto}
                            data-testid={`canto-${canto}`}
                            onPointerDown={(evento) => iniciarArrasto(evento, canto)}
                            onPointerMove={arrastar}
                            onPointerUp={terminarArrasto}
                            onPointerCancel={terminarArrasto}
                            className={`absolute h-3 w-3 rounded-sm border border-white bg-sky-600 ${classes}`}
                            style={{ cursor }}
                          />
                        ))}
                  </div>
                ) : null}
              </PaginaDoPdf>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Arraste o retângulo para cima do espaço em branco da arte e ajuste o tamanho pelos cantos. Com o
            retângulo selecionado, as setas do teclado movem 1 mm (0,1 mm com Shift).
          </p>
        </div>

        <div className="space-y-4">
          {area && emMm ? (
            <>
              <fieldset disabled={bloqueado} className="space-y-3">
                <legend className="text-sm font-medium text-slate-700">Posição e tamanho</legend>
                <p className="text-xs text-slate-500">Medidas a partir do canto superior esquerdo da página.</p>
                <div className="grid grid-cols-2 gap-3">
                  <CampoEmMm rotulo="X" valor={emMm.xMm} desabilitado={bloqueado} aoMudar={(v) => mudarMedida("xMm", v)} />
                  <CampoEmMm rotulo="Y" valor={emMm.yMm} desabilitado={bloqueado} aoMudar={(v) => mudarMedida("yMm", v)} />
                  <CampoEmMm rotulo="Largura" valor={emMm.larguraMm} desabilitado={bloqueado} aoMudar={(v) => mudarMedida("larguraMm", v)} />
                  <CampoEmMm rotulo="Altura" valor={emMm.alturaMm} desabilitado={bloqueado} aoMudar={(v) => mudarMedida("alturaMm", v)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={proporcaoTravada}
                    onChange={(evento) => setProporcaoTravada(evento.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Manter a proporção
                </label>
                <label className="block text-sm text-slate-600">
                  Margem de silêncio (módulos)
                  <input
                    type="number"
                    min={ZONA_DE_SILENCIO_MINIMA}
                    max={ZONA_DE_SILENCIO_MAXIMA}
                    step={1}
                    value={zona}
                    onChange={(evento) => {
                      const valor = Math.round(Number(evento.target.value));
                      if (Number.isFinite(valor)) {
                        setZona(limitar(valor, ZONA_DE_SILENCIO_MINIMA, ZONA_DE_SILENCIO_MAXIMA));
                        setAviso(null);
                      }
                    }}
                    className={classesDoCampo("mt-1 w-24")}
                  />
                </label>
              </fieldset>

              {medidas ? (
                <dl className="space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-sm" data-testid="medidas-do-qr">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">QR Code</dt>
                    <dd className="font-medium text-slate-900">{formatarMm(medidas.ladoMm)} mm</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Com a margem</dt>
                    <dd className="font-medium text-slate-900">{formatarMm(medidas.ladoComMargemMm)} mm</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Módulo</dt>
                    <dd className="font-medium text-slate-900">{formatarMm(medidas.moduloMm)} mm</dd>
                  </div>
                </dl>
              ) : null}
              {medidas?.avisos.map((texto) => (
                <p key={texto} role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {texto}
                </p>
              ))}
              {problemas.map((texto) => (
                <p key={texto} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {texto}
                </p>
              ))}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                A área do QR Code ainda não foi definida. Crie o retângulo e arraste-o para o espaço em branco da arte.
              </p>
              <button
                type="button"
                disabled={bloqueado}
                onClick={() => mudarArea(areaSugerida(visao))}
                className={classesDoBotao("secundario")}
              >
                Posicionar área do QR
              </button>
            </div>
          )}
        </div>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {aviso}
        </p>
      ) : null}

      <div id="teste" className="scroll-mt-6 space-y-3 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {bloqueado ? null : (
            <button
              type="button"
              onClick={aoSalvar}
              disabled={pendente || !area || !alterado || problemas.length > 0}
              className={`${classesDoBotao("secundario")} hidden md:inline-flex`}
            >
              Salvar área
            </button>
          )}
          <button
            type="button"
            onClick={aoTestar}
            disabled={pendente || !area || problemas.length > 0 || (bloqueado && alterado)}
            className={classesDoBotao(testadoEAtual ? "secundario" : "primario")}
          >
            {pendente ? "Aguarde…" : "Testar QR"}
          </button>
          {testadoEAtual ? (
            <>
              <button
                type="button"
                onClick={() => setPreviaDeTeste((atual) => (atual === null ? Date.now() : null))}
                className={classesDoBotao("secundario")}
              >
                {previaDeTeste === null ? "Ver prévia de teste" : "Ocultar prévia"}
              </button>
              <a href={`${urlDoTeste}?baixar=1`} className={classesDoBotao("secundario")}>
                Baixar PDF de teste
              </a>
            </>
          ) : null}
        </div>

        <p className="text-sm text-slate-600">
          {!area
            ? "Defina a área do QR Code para poder testar."
            : testadoEAtual
              ? "Teste feito com a configuração atual. Imprima o PDF de teste em 100% e leia o QR com o celular antes de produzir."
              : alterado
                ? "A área foi alterada: o teste precisa ser refeito. “Testar QR” salva a área e gera o PDF final com um QR de teste."
                : "“Testar QR” gera no servidor o PDF final com um QR de teste. Só depois dele o template pode ser ativado."}
        </p>

        {previaDeTeste !== null && testadoEAtual ? (
          <figure className="space-y-2">
            <figcaption className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Prévia de teste
            </figcaption>
            <div className="max-h-[75vh] overflow-auto rounded-lg border border-amber-300 bg-slate-100">
              <div className="w-max">
                <PaginaDoPdf
                  url={`${urlDoTeste}?v=${previaDeTeste}`}
                  visao={visao}
                  escala={Math.min(escala, CSS_POR_PONTO * 1.5)}
                  rotulo="Prévia de teste: PDF final com o QR Code de teste"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              O QR desta prévia aponta para um endereço de teste que não pertence a nenhum cartão.
            </p>
          </figure>
        ) : null}
      </div>

      {template.status !== "PRONTO" ? (
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={definirComoPadrao}
              onChange={(evento) => setDefinirComoPadrao(evento.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Definir como padrão do produto
          </label>
          <button type="button" onClick={aoAtivar} disabled={pendente || !podeAtivar} className={classesDoBotao("primario")}>
            Salvar e ativar
          </button>
          {!podeAtivar ? (
            <p className="text-sm text-slate-500">
              {!template.temProduto
                ? "Escolha o produto do template para poder ativar."
                : "A ativação é liberada depois de um teste bem-sucedido com a configuração atual."}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-slate-100 pt-5 text-sm text-emerald-800">
          Este template está pronto e pode ser escolhido em novos lotes{template.padrao ? " (é o padrão do produto)" : ""}.
        </p>
      )}
    </div>
  );
}
