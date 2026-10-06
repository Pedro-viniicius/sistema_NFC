"use server";

// Server Actions do painel. Toda ação confere a sessão e valida a entrada no servidor;
// as regras de negócio ficam nos módulos (cards, batches).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterBanco } from "@/db/cliente";
import type { Banco } from "@/db/tipos";
import { ErroDeDominio } from "@/lib/erros";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { encerrarSessao, exigirAdmin, type AdminAutenticado } from "@/modules/auth/sessao";
import { criarLote, esquemaDeNovoLote } from "@/modules/batches/servico";
import { resumirCartao, type CartaoResumo } from "@/modules/cards/apresentacao";
import { extrairCodigo } from "@/modules/cards/codigo";
import { TAMANHO_MAXIMO_URL } from "@/modules/cards/destino";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import {
  ativarCartao,
  atualizarDescricao,
  configurarDestino,
  desativarCartao,
} from "@/modules/cards/servico";
import { TIPOS_DESTINO, ehTipoDestino } from "@/modules/cards/tipos";
import type { EstadoDeFormulario, ResultadoDaAcao } from "./tipos-de-acao";

const ERRO_INESPERADO = "Ocorreu um erro inesperado. Tente novamente.";

function mensagemParaOAdmin(erro: unknown): string {
  if (erro instanceof ErroDeDominio) return erro.message;
  if (erro instanceof z.ZodError) return erro.issues[0]?.message ?? "Dados inválidos.";
  registrarLog("erro", "admin.acao_falhou", { mensagem: mensagemDoErro(erro) });
  return ERRO_INESPERADO;
}

async function executar<T>(
  operacao: (db: Banco, admin: AdminAutenticado) => Promise<T>,
): Promise<ResultadoDaAcao<T>> {
  const admin = await exigirAdmin();
  try {
    return { ok: true, dados: await operacao(obterBanco(), admin) };
  } catch (erro) {
    return { ok: false, erro: mensagemParaOAdmin(erro) };
  }
}

function atualizarPainel(): void {
  revalidatePath("/admin", "layout");
}

export async function buscarCartaoAction(entrada: unknown): Promise<ResultadoDaAcao<CartaoResumo>> {
  return executar(async (db) => {
    const codigo = extrairCodigo(entrada);
    if (!codigo) {
      throw new ErroDeDominio(
        "CODIGO_INVALIDO",
        "Código inválido. Confira os 6 caracteres impressos no cartão.",
      );
    }
    const cartao = await buscarCartaoPorCodigo(db, codigo);
    if (!cartao) {
      throw new ErroDeDominio("CARTAO_NAO_ENCONTRADO", `Nenhum cartão encontrado com o código ${codigo}.`);
    }
    return resumirCartao(cartao);
  });
}

const esquemaDeConfiguracao = z.object({
  codigo: z.string().max(200),
  tipo: z.enum(TIPOS_DESTINO, "Escolha o tipo de destino."),
  destinoUrl: z.string().max(TAMANHO_MAXIMO_URL + 100, "A URL de destino é longa demais."),
  ativar: z.boolean().default(false),
});

export async function configurarDestinoAction(entrada: unknown): Promise<ResultadoDaAcao<CartaoResumo>> {
  return executar(async (db, admin) => {
    const dados = esquemaDeConfiguracao.parse(entrada);
    const cartao = await configurarDestino(db, dados);
    registrarLog("info", "admin.destino_configurado", {
      codigo: cartao.codigo,
      tipo: cartao.tipo,
      adminId: admin.id,
    });
    atualizarPainel();
    return resumirCartao(cartao);
  });
}

const esquemaDeStatus = z.object({
  codigo: z.string().max(200),
  operacao: z.enum(["ativar", "desativar"]),
});

export async function alterarStatusAction(entrada: unknown): Promise<ResultadoDaAcao<CartaoResumo>> {
  return executar(async (db, admin) => {
    const { codigo, operacao } = esquemaDeStatus.parse(entrada);
    const cartao =
      operacao === "ativar" ? await ativarCartao(db, codigo) : await desativarCartao(db, codigo);
    registrarLog("info", "admin.status_alterado", {
      codigo: cartao.codigo,
      status: cartao.status,
      adminId: admin.id,
    });
    atualizarPainel();
    return resumirCartao(cartao);
  });
}

const esquemaDeDescricao = z.object({
  codigo: z.string().max(200),
  descricao: z.string().max(1000),
});

export async function atualizarDescricaoAction(entrada: unknown): Promise<ResultadoDaAcao<CartaoResumo>> {
  return executar(async (db) => {
    const { codigo, descricao } = esquemaDeDescricao.parse(entrada);
    const cartao = await atualizarDescricao(db, codigo, descricao);
    atualizarPainel();
    return resumirCartao(cartao);
  });
}

export async function criarLoteAction(
  _anterior: EstadoDeFormulario,
  formulario: FormData,
): Promise<EstadoDeFormulario> {
  const admin = await exigirAdmin();
  const tipo = formulario.get("tipo");

  let identificador: string;
  try {
    const dados = esquemaDeNovoLote.parse({
      quantidade: formulario.get("quantidade"),
      tipo: ehTipoDestino(tipo) ? tipo : null,
      descricao: formulario.get("descricao") ?? "",
    });
    const { lote } = await criarLote(obterBanco(), dados);
    identificador = lote.identificador;
    registrarLog("info", "admin.lote_criado", {
      lote: identificador,
      quantidade: lote.quantidade,
      adminId: admin.id,
    });
  } catch (erro) {
    return { erro: mensagemParaOAdmin(erro) };
  }

  atualizarPainel();
  redirect(`/admin/lotes/${identificador}`);
}

export async function sairAction(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
