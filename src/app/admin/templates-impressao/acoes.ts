"use server";

// Server Actions dos templates de impressão. Toda ação confere a sessão e valida a entrada no
// servidor; as regras ficam em src/modules/templates.
import { revalidatePath } from "next/cache";
import { registrarLog } from "@/lib/log";
import { obterArmazenamento } from "@/modules/storage";
import {
  ativarTemplate,
  atualizarDadosDoTemplate,
  configurarQrDoTemplate,
  definirTemplatePadrao,
  duplicarTemplate,
  excluirTemplate,
  inativarTemplate,
  testarQrDoTemplate,
} from "@/modules/templates/servico";
import { executar } from "../executar-acao";
import type { ResultadoDaAcao } from "../tipos-de-acao";

interface TemplateAlterado {
  id: string;
  nome: string;
  status: string;
}

function atualizarTelas(): void {
  revalidatePath("/admin", "layout");
}

const resumo = (template: { id: string; nome: string; status: string }): TemplateAlterado => ({
  id: template.id,
  nome: template.nome,
  status: template.status,
});

export async function atualizarDadosDoTemplateAction(
  id: string,
  dados: { nome: string; tipo: string | null },
): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db) => {
    const template = await atualizarDadosDoTemplate(db, String(id), dados);
    atualizarTelas();
    return resumo(template);
  });
}

export async function salvarAreaDoQrAction(
  id: string,
  configuracao: unknown,
): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db, admin) => {
    const template = await configurarQrDoTemplate(db, String(id), configuracao);
    registrarLog("info", "templates.qr_configurado", { templateId: template.id, adminId: admin.id });
    atualizarTelas();
    return resumo(template);
  });
}

/** Gera de verdade o PDF final com a URL reservada de teste; se der certo, libera a ativação. */
export async function testarQrAction(id: string): Promise<ResultadoDaAcao<TemplateAlterado & { testadoEm: string }>> {
  return executar(async (db, admin) => {
    const template = await testarQrDoTemplate(db, obterArmazenamento(), String(id));
    registrarLog("info", "templates.qr_testado", { templateId: template.id, adminId: admin.id });
    atualizarTelas();
    return { ...resumo(template), testadoEm: (template.qrTestadoEm ?? new Date()).toISOString() };
  });
}

export async function ativarTemplateAction(
  id: string,
  opcoes: { definirComoPadrao?: boolean } = {},
): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db, admin) => {
    const template = await ativarTemplate(db, obterArmazenamento(), String(id), {
      definirComoPadrao: opcoes?.definirComoPadrao === true,
    });
    registrarLog("info", "templates.ativado", { templateId: template.id, padrao: template.padrao, adminId: admin.id });
    atualizarTelas();
    return resumo(template);
  });
}

export async function definirPadraoAction(id: string, padrao: boolean): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db, admin) => {
    const template = await definirTemplatePadrao(db, String(id), padrao === true);
    registrarLog("info", "templates.padrao_alterado", { templateId: template.id, padrao: template.padrao, adminId: admin.id });
    atualizarTelas();
    return resumo(template);
  });
}

export async function inativarTemplateAction(id: string): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db, admin) => {
    const template = await inativarTemplate(db, String(id));
    registrarLog("info", "templates.inativado", { templateId: template.id, adminId: admin.id });
    atualizarTelas();
    return resumo(template);
  });
}

export async function duplicarTemplateAction(id: string): Promise<ResultadoDaAcao<TemplateAlterado>> {
  return executar(async (db, admin) => {
    const copia = await duplicarTemplate(db, obterArmazenamento(), String(id));
    registrarLog("info", "templates.duplicado", { origem: String(id), templateId: copia.id, adminId: admin.id });
    atualizarTelas();
    return resumo(copia);
  });
}

export async function excluirTemplateAction(id: string): Promise<ResultadoDaAcao<{ id: string }>> {
  return executar(async (db, admin) => {
    await excluirTemplate(db, obterArmazenamento(), String(id));
    registrarLog("aviso", "templates.excluido", { templateId: String(id), adminId: admin.id });
    atualizarTelas();
    return { id: String(id) };
  });
}
