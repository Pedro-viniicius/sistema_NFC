"use client";

// Envio do PDF do template. O arquivo vai do navegador DIRETO para o armazenamento (ele não cabe
// no limite de 4,5 MB das funções da Vercel) e só depois o servidor é chamado para validar e registrar.
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";
import { tamanhoLegivel } from "@/modules/templates/formato";

type Estado =
  | { fase: "ocioso" }
  | { fase: "enviando"; progresso: number }
  | { fase: "validando" }
  | { fase: "concluido"; descricao: string }
  | { fase: "erro"; mensagem: string };

interface Props {
  /** Para onde o navegador envia o arquivo: Vercel Blob, disco local (desenvolvimento) ou indisponível. */
  modo: "vercel-blob" | "local" | "indisponivel";
  limiteBytes: number;
  /** Se informado, o envio troca a arte deste rascunho em vez de criar um template. */
  templateId?: string;
  rotulo?: string;
}

/** Erro com mensagem já pronta para o administrador. */
class ErroDeEnvio extends Error {}

async function corpoJson(resposta: Response): Promise<Record<string, unknown>> {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function EnvioDeTemplate({ modo, limiteBytes, templateId, rotulo = "Arquivo PDF" }: Props) {
  const roteador = useRouter();
  const id = useId();
  const [estado, setEstado] = useState<Estado>({ fase: "ocioso" });
  const ocupado = estado.fase === "enviando" || estado.fase === "validando";

  async function enviar(arquivo: File): Promise<void> {
    if (!/\.pdf$/i.test(arquivo.name)) throw new ErroDeEnvio("Escolha um arquivo PDF (extensão .pdf).");
    if (arquivo.size === 0) throw new ErroDeEnvio("O arquivo está vazio.");
    if (arquivo.size > limiteBytes) {
      throw new ErroDeEnvio(
        `Este arquivo tem ${tamanhoLegivel(arquivo.size)}. O tamanho máximo de um template é ${tamanhoLegivel(limiteBytes)}.`,
      );
    }

    setEstado({ fase: "enviando", progresso: 0 });
    let chave: string;
    if (modo === "vercel-blob") {
      const enviado = await upload("templates-impressao/template.pdf", arquivo, {
        access: "private",
        contentType: "application/pdf",
        handleUploadUrl: "/api/templates-impressao/upload",
        onUploadProgress: ({ percentage }) => setEstado({ fase: "enviando", progresso: Math.round(percentage) }),
      });
      chave = enviado.pathname;
    } else {
      const resposta = await fetch("/api/templates-impressao/envio-local", {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: arquivo,
      });
      const corpo = await corpoJson(resposta);
      if (!resposta.ok || typeof corpo.chave !== "string") {
        throw new ErroDeEnvio(typeof corpo.erro === "string" ? corpo.erro : "Não foi possível enviar o arquivo.");
      }
      chave = corpo.chave;
    }

    setEstado({ fase: "validando" });
    const resposta = await fetch("/api/templates-impressao/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, nomeOriginal: arquivo.name, templateId }),
    });
    const corpo = await corpoJson(resposta);
    if (!resposta.ok || typeof corpo.id !== "string") {
      throw new ErroDeEnvio(typeof corpo.erro === "string" ? corpo.erro : "Não foi possível validar o arquivo.");
    }

    setEstado({ fase: "concluido", descricao: typeof corpo.descricao === "string" ? corpo.descricao : "PDF válido" });
    if (templateId) roteador.refresh();
    else roteador.push(`/admin/templates-impressao/${corpo.id}`);
  }

  function aoEscolher(evento: ChangeEvent<HTMLInputElement>): void {
    const arquivo = evento.target.files?.[0];
    // Limpa o campo para permitir escolher de novo o mesmo arquivo depois de um erro.
    evento.target.value = "";
    if (!arquivo) return;
    enviar(arquivo).catch((erro: unknown) => {
      setEstado({
        fase: "erro",
        mensagem:
          erro instanceof ErroDeEnvio
            ? erro.message
            : "Não foi possível enviar o arquivo. Confira a conexão e tente novamente.",
      });
    });
  }

  if (modo === "indisponivel") {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        O armazenamento de arquivos não está configurado neste ambiente. Conecte um Blob store ao projeto na Vercel
        (variável BLOB_READ_WRITE_TOKEN) para enviar templates.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
          {rotulo}
        </label>
        <input
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          disabled={ocupado}
          onChange={aoEscolher}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          PDF de uma página, sem senha e sem rotação, de até {tamanhoLegivel(limiteBytes)}. O envio começa assim que
          o arquivo é escolhido.
        </p>
      </div>

      {estado.fase === "enviando" ? (
        <div role="status" className="text-sm text-slate-700">
          <p>Enviando o arquivo… {estado.progresso}%</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-slate-900 transition-[width]" style={{ width: `${estado.progresso}%` }} />
          </div>
        </div>
      ) : null}
      {estado.fase === "validando" ? (
        <p role="status" className="text-sm text-slate-700">
          Validando o PDF no servidor…
        </p>
      ) : null}
      {estado.fase === "concluido" ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {estado.descricao}
        </p>
      ) : null}
      {estado.fase === "erro" ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.mensagem}
        </p>
      ) : null}
    </div>
  );
}
