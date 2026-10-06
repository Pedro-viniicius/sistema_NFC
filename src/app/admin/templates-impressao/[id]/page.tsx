import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { Painel, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { exigirAdmin } from "@/modules/auth/sessao";
import { tamanhoLegivel } from "@/modules/templates/formato";
import {
  TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE,
  buscarTemplate,
  configuracaoDoQr,
  contarLotesDoTemplate,
  modulosDoQrDeProducao,
  pendenciasParaAtivar,
  qrTestado,
  templateBloqueado,
  visaoDoTemplate,
} from "@/modules/templates/servico";
import { MAX_TEMPLATE_BYTES, descreverPdfDoTemplate } from "@/modules/templates/validacao-do-pdf";
import { AcoesDoTemplate } from "../acoes-do-template";
import { modoDeEnvio } from "../armazenamento";
import { DadosDoTemplate } from "../dados";
import { EditorDoQr } from "../editor";
import { EnvioDeTemplate } from "../envio";
import { SeloDePadrao, SeloDoTemplate } from "../selo";

export const metadata: Metadata = { title: "Template de impressão — Cartões NFC" };

export default async function PaginaDoTemplate({ params }: PageProps<"/admin/templates-impressao/[id]">) {
  await exigirAdmin();
  const db = obterBanco();
  const template = await buscarTemplate(db, (await params).id);
  if (!template) notFound();

  const lotes = await contarLotesDoTemplate(db, template.id);
  const bloqueado = templateBloqueado(template);
  const config = configuracaoDoQr(template);
  const pendencias = pendenciasParaAtivar(template);
  const arquivo = `/admin/templates-impressao/${template.id}/arquivo`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/templates-impressao" className="text-slate-500 hover:text-slate-900">
          ← Templates de impressão
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{template.nome}</h1>
        <SeloDoTemplate status={template.status} />
        {template.padrao ? <SeloDePadrao /> : null}
        <span className="text-sm text-slate-500">
          {template.tipo ? rotuloDoTipo(template.tipo) : "Produto a definir"}
          {lotes > 0 ? ` · Em uso por ${lotes} ${lotes === 1 ? "lote" : "lotes"}` : ""}
        </span>
      </div>

      {template.status === "RASCUNHO" && pendencias.length > 0 ? (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Rascunho — falta para ativar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {pendencias.map((pendencia) => (
              <li key={pendencia}>{pendencia}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-4">
        <Painel titulo="Arquivo">
          <p className="break-words text-sm font-medium text-emerald-800" data-testid="descricao-do-pdf">
            PDF válido · {descreverPdfDoTemplate(template)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {tamanhoLegivel(template.tamanhoBytes)} · enviado em {formatarDataHora(template.criadoEm)} · atualizado em{" "}
            {formatarDataHora(template.atualizadoEm)}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-slate-400">SHA-256 {template.sha256}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={arquivo} target="_blank" rel="noopener noreferrer" className={classesDoBotao("secundario")}>
              Abrir o PDF original
            </a>
          </div>
          {bloqueado ? null : (
            <details className="mt-4 border-t border-slate-100 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Trocar o arquivo da arte</summary>
              <p className="my-3 text-sm text-slate-500">
                A nova arte é gravada como um arquivo novo. A área do QR Code é mantida se couber na nova página, e o
                teste precisa ser refeito.
              </p>
              <EnvioDeTemplate
                modo={modoDeEnvio()}
                limiteBytes={MAX_TEMPLATE_BYTES}
                templateId={template.id}
                rotulo="Novo arquivo PDF"
              />
            </details>
          )}
        </Painel>

        <div id="dados" className="scroll-mt-6">
          <Painel titulo="Produto e nome">
            <DadosDoTemplate
              id={template.id}
              nome={template.nome}
              tipo={template.tipo}
              tamanhoMaximoDoNome={TAMANHO_MAXIMO_DO_NOME_DO_TEMPLATE}
              bloqueado={bloqueado}
            />
          </Painel>
        </div>

        <div id="qr" className="scroll-mt-6">
          <Painel
            titulo="Área do QR Code"
            descricao="O QR é o maior quadrado que cabe na área, centralizado, com a margem de silêncio por dentro."
          >
            <EditorDoQr
              template={{
                id: template.id,
                nome: template.nome,
                status: template.status,
                temProduto: template.tipo !== null,
                padrao: template.padrao,
                visao: visaoDoTemplate(template),
                area: config?.area ?? null,
                zonaDeSilencioModulos: template.qrZonaDeSilencioModulos,
                bloqueado,
                testado: qrTestado(template),
              }}
              modulosPorLado={modulosDoQrDeProducao()}
            />
          </Painel>
        </div>

        <Painel
          titulo="Outras ações"
          descricao={
            bloqueado
              ? "Template usado em lotes: não pode ser excluído nem ter a arte alterada. Para mudar, duplique como nova versão."
              : "Enquanto nenhum lote usar este template, ele pode ser alterado ou excluído."
          }
        >
          <AcoesDoTemplate
            id={template.id}
            nome={template.nome}
            status={template.status}
            padrao={template.padrao}
            podeExcluir={lotes === 0}
            aoExcluirIrPara="/admin/templates-impressao"
          />
        </Painel>
      </div>
    </>
  );
}
