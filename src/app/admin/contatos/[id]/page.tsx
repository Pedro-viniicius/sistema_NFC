import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { Painel, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { formatarWhatsApp, linkDoWhatsApp } from "@/modules/activation/whatsapp";
import { exigirAdmin } from "@/modules/auth/sessao";
import { buscarContato, quemDecide } from "@/modules/contacts/servico";
import { PAPEL_NO_PAINEL, ROTULO_RAMO } from "@/modules/contacts/tipos";
import { Acompanhamento, ExcluirContato } from "../controles";

export const metadata: Metadata = { title: "Contato — Cartões NFC" };

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default async function PaginaDoContato({ params }: PageProps<"/admin/contatos/[id]">) {
  await exigirAdmin();
  const contato = await buscarContato(obterBanco(), (await params).id);
  if (!contato) notFound();

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/contatos" className="text-slate-500 hover:text-slate-900">
          ← Contatos
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{contato.loja}</h1>
        {contato.cartoesDaLoja > 1 ? (
          <Link
            href={`/admin/contatos?q=${encodeURIComponent(formatarWhatsApp(contato.whatsapp))}`}
            className="rounded-full bg-violet-50 px-3 py-1 text-sm font-medium text-violet-800 ring-1 ring-inset ring-violet-200"
          >
            Esta loja tem {contato.cartoesDaLoja} cartões
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Painel titulo="Contato">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dado rotulo="Loja ou empresa">{contato.loja}</Dado>
              <Dado rotulo="Ramo">{contato.ramo ? ROTULO_RAMO[contato.ramo] : "Não informado"}</Dado>
              <Dado rotulo="Nome de quem ativou">
                {contato.nome} <span className="font-normal text-slate-500">· {PAPEL_NO_PAINEL[contato.papel]}</span>
              </Dado>
              <Dado rotulo="Quem decide as coisas na loja">{quemDecide(contato)}</Dado>
              <Dado rotulo="WhatsApp">{formatarWhatsApp(contato.whatsapp)}</Dado>
              <Dado rotulo="Aceitou receber ofertas">
                {contato.aceitouOfertas ? "Sim" : "Não — use este contato só para suporte do cartão"}
              </Dado>
            </dl>
            <a
              href={linkDoWhatsApp(contato.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className={classesDoBotao("primario", "mt-5")}
            >
              Abrir conversa no WhatsApp
            </a>
          </Painel>

          <Painel titulo="Acompanhamento">
            <Acompanhamento id={contato.id} situacao={contato.situacao} observacao={contato.observacao} />
          </Painel>
        </div>

        <div className="space-y-4">
          <Painel titulo="Cartão">
            <dl className="space-y-3">
              <Dado rotulo="Código">
                {contato.cartaoId ? (
                  <Link href={`/admin/cartoes/${contato.cartaoCodigo}`} className="font-mono underline underline-offset-2">
                    {contato.cartaoCodigo}
                  </Link>
                ) : (
                  <span className="font-mono">{contato.cartaoCodigo} (cartão apagado)</span>
                )}
              </Dado>
              <Dado rotulo="Lote">
                {contato.loteIdentificador ? <span className="font-mono">{contato.loteIdentificador}</span> : "—"}
              </Dado>
              <Dado rotulo="Tipo">{rotuloDoTipo(contato.tipo)}</Dado>
              <Dado rotulo="Ativado em">{formatarDataHora(contato.registradoEm)}</Dado>
            </dl>
          </Painel>

          <Painel
            titulo="Privacidade"
            descricao="Registro do que foi mostrado e aceito na ativação."
          >
            <dl className="space-y-3">
              <Dado rotulo="Texto exibido (versão)">
                <span className="font-mono text-sm">{contato.versaoDoTexto}</span>
              </Dado>
              <Dado rotulo="Aceite de ofertas">{contato.aceitouOfertas ? "Marcado" : "Não marcado"}</Dado>
              <Dado rotulo="Data e hora">{formatarDataHora(contato.registradoEm)}</Dado>
            </dl>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="mb-3 text-sm text-slate-600">
                Se a pessoa pedir, exclua os dados dela. O cartão continua ativo e abrindo o mesmo link.
              </p>
              <ExcluirContato id={contato.id} loja={contato.loja} />
            </div>
          </Painel>
        </div>
      </div>
    </>
  );
}
