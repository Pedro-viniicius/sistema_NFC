"use server";

// Server Actions do painel. Toda ação confere a sessão e valida a entrada no servidor;
// as regras de negócio ficam nos módulos (cards, batches).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterBanco } from "@/db/cliente";
import { ErroDeDominio } from "@/lib/erros";
import { registrarLog } from "@/lib/log";
import { encerrarSessao, exigirAdmin } from "@/modules/auth/sessao";
import { criarLote, esquemaDeNovoLote, excluirLote, type LoteExcluido } from "@/modules/batches/servico";
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
import {
  TAMANHO_MAXIMO_DA_ARTE_BYTES,
  esquemaDaConfiguracaoDaArte,
  removerArte,
  salvarArte,
} from "@/modules/printing/artes";
import { obterModeloPorSlug, type ModeloDeImpressao } from "@/modules/printing/modelos";
import { executar, mensagemParaOAdmin } from "./executar-acao";
import type { EstadoDeFormulario, ResultadoDaAcao } from "./tipos-de-acao";

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
    const template = formulario.get("templateId");
    const dados = esquemaDeNovoLote.parse({
      quantidade: formulario.get("quantidade"),
      tipo: ehTipoDestino(tipo) ? tipo : null,
      descricao: formulario.get("descricao") ?? "",
      // Vazio = lote sem template (modelo do sistema). A regra do template é conferida no servidor.
      templateId: typeof template === "string" && template.length > 0 ? template : null,
    });
    const { lote } = await criarLote(obterBanco(), dados);
    identificador = lote.identificador;
    registrarLog("info", "admin.lote_criado", {
      lote: identificador,
      quantidade: lote.quantidade,
      templateId: lote.templateId,
      adminId: admin.id,
    });
  } catch (erro) {
    return { erro: mensagemParaOAdmin(erro) };
  }

  atualizarPainel();
  redirect(`/admin/lotes/${identificador}`);
}

export async function excluirLoteAction(
  _anterior: EstadoDeFormulario,
  formulario: FormData,
): Promise<EstadoDeFormulario> {
  const admin = await exigirAdmin();
  const identificador = formulario.get("identificador");
  const confirmacao = formulario.get("confirmacao");

  let excluido: LoteExcluido;
  try {
    if (typeof identificador !== "string" || typeof confirmacao !== "string") {
      throw new ErroDeDominio("ENTRADA_INVALIDA", "Dados inválidos.");
    }
    excluido = await excluirLote(obterBanco(), identificador, confirmacao);
    registrarLog("aviso", "admin.lote_excluido", {
      lote: excluido.identificador,
      cartoes: excluido.cartoesExcluidos,
      adminId: admin.id,
    });
  } catch (erro) {
    return { erro: mensagemParaOAdmin(erro) };
  }

  atualizarPainel();
  redirect(`/admin/lotes?apagado=${excluido.identificador}&cartoes=${excluido.cartoesExcluidos}`);
}

function modeloDoFormulario(formulario: FormData): ModeloDeImpressao {
  const modelo = obterModeloPorSlug(formulario.get("modelo"));
  if (!modelo) throw new ErroDeDominio("MODELO_NAO_ENCONTRADO", "Modelo de impressão desconhecido.");
  return modelo;
}

export async function enviarArteAction(
  _anterior: EstadoDeFormulario,
  formulario: FormData,
): Promise<EstadoDeFormulario> {
  const admin = await exigirAdmin();
  try {
    const modelo = modeloDoFormulario(formulario);
    const arquivo = formulario.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      throw new ErroDeDominio("ENTRADA_INVALIDA", "Selecione o arquivo PDF da arte.");
    }
    if (arquivo.size > TAMANHO_MAXIMO_DA_ARTE_BYTES) {
      throw new ErroDeDominio("ENTRADA_INVALIDA", "O arquivo é maior que o limite de 2 MB.");
    }
    const cor = formulario.get("corDoCodigo");

    const { comSangria } = await salvarArte(obterBanco(), modelo, {
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      nomeDoArquivo: arquivo.name,
      ...esquemaDaConfiguracaoDaArte.parse({
        qrXMm: formulario.get("qrXMm"),
        qrYMm: formulario.get("qrYMm"),
        qrTamanhoMm: formulario.get("qrTamanhoMm"),
        corDoCodigo: cor === "preto" || cor === "branco" ? cor : null,
      }),
    });
    registrarLog("info", "admin.arte_enviada", {
      modelo: modelo.slug,
      bytes: arquivo.size,
      comSangria,
      adminId: admin.id,
    });
    atualizarPainel();
    return {
      sucesso: `Arte do modelo ${modelo.nome} salva. Confira a amostra antes de gerar arquivos para a gráfica.`,
      aviso: comSangria
        ? undefined
        : "A arte foi enviada no tamanho final, sem sangria: pode sobrar uma borda branca fina depois do corte.",
    };
  } catch (erro) {
    return { erro: mensagemParaOAdmin(erro) };
  }
}

export async function restaurarArteAction(
  _anterior: EstadoDeFormulario,
  formulario: FormData,
): Promise<EstadoDeFormulario> {
  const admin = await exigirAdmin();
  try {
    const modelo = modeloDoFormulario(formulario);
    const removida = await removerArte(obterBanco(), modelo);
    registrarLog("info", "admin.arte_restaurada", { modelo: modelo.slug, removida, adminId: admin.id });
    atualizarPainel();
    return { sucesso: `O modelo ${modelo.nome} voltou a usar a arte padrão do sistema.` };
  } catch (erro) {
    return { erro: mensagemParaOAdmin(erro) };
  }
}

export async function sairAction(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
