import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { BotaoCopiar } from "@/components/botao-copiar";
import { Painel, SeloDeStatus, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { buscarLotePorId } from "@/modules/batches/servico";
import { resumirCartao } from "@/modules/cards/apresentacao";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { listarModelos } from "@/modules/printing/modelos";
import { formatarWhatsApp, linkDoWhatsApp } from "@/modules/activation/whatsapp";
import { buscarContatoDoCartao, quemDecide } from "@/modules/contacts/servico";
import { ROTULO_SITUACAO } from "@/modules/contacts/tipos";
import { sugerirModelo } from "@/modules/printing/producao";
import { formatarDimensoesMm } from "@/modules/templates/formato";
import { buscarTemplateDoLote } from "@/modules/templates/producao";
import { tiposParaAArteDoCartao } from "@/modules/printing/servico";
import { nomeDoArquivoQr } from "@/modules/qr/gerar";
import { BotoesDeStatus, EditorDeDescricao, EditorDeDestino } from "./controles";

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default async function PaginaDoCartao({ params }: PageProps<"/admin/cartoes/[codigo]">) {
  await exigirAdmin();
  const codigo = normalizarCodigo((await params).codigo);
  if (!codigo) notFound();

  const db = obterBanco();
  const cartao = await buscarCartaoPorCodigo(db, codigo);
  if (!cartao) notFound();

  const resumo = resumirCartao(cartao);
  const lote = cartao.loteId ? await buscarLotePorId(db, cartao.loteId) : null;
  const modeloDaArte = sugerirModelo(...tiposParaAArteDoCartao(cartao, lote));
  // Cartão de um lote gerado com template de impressão: a arte é sempre a do template do lote.
  const template = lote ? await buscarTemplateDoLote(db, lote) : null;
  // Contato de quem ativou o cartão pela página pública (se foi o cliente quem ativou).
  const contato = await buscarContatoDoCartao(db, cartao.id);
  const urlDoQr = `/admin/cartoes/${cartao.codigo}/qr`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/cartoes" className="text-slate-500 hover:text-slate-900">
          ← Cartões
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-3xl font-semibold tracking-wider text-slate-900">{cartao.codigo}</h1>
        <SeloDeStatus status={cartao.status} />
        <span className="text-sm text-slate-500">Código permanente — não pode ser alterado</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {contato ? (
            <Painel titulo="Quem ativou este cartão" descricao="O próprio cliente ativou o cartão e deixou estes dados.">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-slate-500">Loja</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{contato.loja}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Nome</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{contato.nome}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Quem decide</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{quemDecide(contato)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">WhatsApp</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-slate-900">{formatarWhatsApp(contato.whatsapp)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Ativado em</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{formatarDataHora(contato.registradoEm)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Situação</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {ROTULO_SITUACAO[contato.situacao]} · {contato.aceitouOfertas ? "aceitou ofertas" : "não aceitou ofertas"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={linkDoWhatsApp(contato.whatsapp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classesDoBotao("primario")}
                >
                  Abrir conversa no WhatsApp
                </a>
                <Link href={`/admin/contatos/${contato.id}`} className={classesDoBotao("secundario")}>
                  Ver contato
                </Link>
              </div>
            </Painel>
          ) : null}

          <Painel
            titulo="URL permanente"
            descricao="É esta URL que vai no QR Code impresso e no chip NFC. Ela nunca muda, mesmo quando o destino é alterado."
          >
            <p className="mb-1 text-sm text-slate-500">URL para gravar no NFC:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-3 py-2.5 font-mono text-sm text-slate-900">
                {resumo.urlPermanente}
              </code>
              <BotaoCopiar texto={resumo.urlPermanente} rotulo="Copiar URL permanente" />
            </div>
          </Painel>

          <Painel titulo="Destino atual" descricao="Para onde o cartão redireciona hoje. Pode ser alterado a qualquer momento.">
            <EditorDeDestino cartao={resumo} />
          </Painel>

          <Painel titulo="Informações">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Dado rotulo="Status">
                <SeloDeStatus status={cartao.status} />
              </Dado>
              <Dado rotulo="Tipo">{rotuloDoTipo(cartao.tipo)}</Dado>
              <Dado rotulo="Lote">
                {lote ? (
                  <Link href={`/admin/lotes/${lote.identificador}`} className="underline underline-offset-2">
                    {lote.identificador}
                  </Link>
                ) : (
                  "—"
                )}
              </Dado>
              <Dado rotulo="Data de criação">{formatarDataHora(cartao.criadoEm)}</Dado>
              <Dado rotulo="Data de ativação">{formatarDataHora(cartao.ativadoEm)}</Dado>
              <Dado rotulo="Última alteração">{formatarDataHora(cartao.atualizadoEm)}</Dado>
              <Dado rotulo="Total de acessos">{cartao.totalAcessos.toLocaleString("pt-BR")}</Dado>
              <Dado rotulo="Último acesso">{formatarDataHora(cartao.ultimoAcessoEm)}</Dado>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Os acessos somam leituras por QR Code e por NFC: as duas usam a mesma URL, então não é possível
              distingui-las.
            </p>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <EditorDeDescricao cartao={resumo} />
            </div>
          </Painel>
        </div>

        <div className="space-y-4">
          <Painel titulo="QR Code" descricao="Contém apenas a URL permanente.">
            {/* SVG gerado pelo próprio sistema, servido por rota autenticada. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urlDoQr}
              alt={`QR Code do cartão ${cartao.codigo}`}
              width={240}
              height={240}
              className="mx-auto w-full max-w-60 rounded-lg border border-slate-200 bg-white"
            />
            <div className="mt-4 grid gap-2">
              <a
                href={`${urlDoQr}?formato=svg&baixar=1`}
                download={nomeDoArquivoQr(cartao.codigo, "svg")}
                className={classesDoBotao("primario")}
              >
                Baixar QR SVG
              </a>
              <a
                href={`${urlDoQr}?formato=png&baixar=1`}
                download={nomeDoArquivoQr(cartao.codigo, "png")}
                className={classesDoBotao("secundario")}
              >
                Baixar PNG
              </a>
            </div>
            <p className="mt-3 text-xs text-slate-500">Prefira o SVG para impressão profissional.</p>
          </Painel>

          {template ? (
            <Painel
              titulo="Arte para impressão"
              descricao={`Template do lote: ${template.nome}. É a arte original com o QR Code deste cartão.`}
            >
              <div className="grid gap-2">
                <a href={`/admin/cartoes/${cartao.codigo}/impressao`} className={classesDoBotao("primario")}>
                  Baixar arte para impressão
                </a>
                <a
                  href={`/admin/cartoes/${cartao.codigo}/impressao?ver=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classesDoBotao("secundario")}
                >
                  Ver arte (PDF)
                </a>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                PDF no tamanho do template ({formatarDimensoesMm(template.larguraDaPaginaMm, template.alturaDaPaginaMm)}).
                O QR contém apenas a URL permanente.
              </p>
            </Painel>
          ) : (
            <Painel
              titulo="Arte para impressão"
              descricao={
                modeloDaArte
                  ? `Modelo ${modeloDaArte.nome}: arte final com o QR Code deste cartão, pronta para a gráfica.`
                  : "Este cartão não tem um modelo definido. Escolha a arte:"
              }
            >
              <div className="grid gap-2">
                {(modeloDaArte ? [modeloDaArte] : listarModelos()).map((modelo) => (
                  <a
                    key={modelo.slug}
                    href={`/admin/cartoes/${cartao.codigo}/impressao?modelo=${modelo.slug}`}
                    className={classesDoBotao(modeloDaArte ? "primario" : "secundario")}
                  >
                    {modeloDaArte ? "Baixar arte para impressão" : `Baixar arte — ${modelo.nome}`}
                  </a>
                ))}
                {modeloDaArte ? (
                  <a
                    href={`/admin/cartoes/${cartao.codigo}/impressao?modelo=${modeloDaArte.slug}&ver=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classesDoBotao("secundario")}
                  >
                    Ver arte (PDF)
                  </a>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                PDF vetorial de 86 × 54 mm com 3 mm de sangria. O QR contém apenas a URL permanente.
              </p>
            </Painel>
          )}

          <Painel
            titulo={cartao.status === "INATIVO" ? "Ativar cartão" : "Desativar cartão"}
            descricao={
              cartao.status === "INATIVO"
                ? "O cartão volta a funcionar com o destino já salvo."
                : "Um cartão inativo mostra uma página de indisponível em vez de redirecionar."
            }
          >
            <BotoesDeStatus cartao={resumo} />
          </Painel>
        </div>
      </div>
    </>
  );
}
