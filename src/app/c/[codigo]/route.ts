// Rota pública do cartão: /c/[codigo]
//
// GET  — cartão configurado: uma consulta ao banco e um 302, como sempre foi.
//        cartão não configurado de um lote com "Ativação pelo cliente": abre o passo a passo.
//        qualquer outro caso: as páginas de sempre.
//        Abrir a página NUNCA altera o cartão (robôs de pré-visualização também abrem links).
// POST — conferência de um passo ou o envio final da ativação pelo cliente.
//        É o único caminho público que grava algo, e só enquanto o cartão não está configurado.
//
// Route Handler puro (sem React). Nenhuma resposta desta rota pode ficar em cache.
import { ipAddress } from "@vercel/functions";
import { after } from "next/server";
import { obterBanco } from "@/db/cliente";
import type { Banco } from "@/db/tipos";
import { obterAuthSecret } from "@/lib/env";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { obterConfiguracaoDeAtivacao } from "@/modules/activation/configuracao";
import {
  LIMITES_DA_ATIVACAO,
  chaveDoCartao,
  chaveDoIp,
  limparLimitesVencidos,
  registrarTentativa,
} from "@/modules/activation/limite";
import {
  CAMPO_ISCA,
  paginaDeAtivacao,
  paginaDeAviso,
  paginaDeCartaoAtivado,
  respostaEmJson,
} from "@/modules/activation/pagina";
import { VERSAO_DO_TEXTO_DE_PRIVACIDADE } from "@/modules/activation/privacidade";
import { ativarPeloCliente, buscarCartaoParaAtivar } from "@/modules/activation/servico";
import { conferirPasso, validarAtivacao } from "@/modules/activation/validacao";
import { normalizarCodigo } from "@/modules/cards/codigo";
import { registrarAcesso } from "@/modules/cards/repositorio";
import { resolverRedirecionamento, type Resolucao } from "@/modules/redirects/resolver";
import { respostaDaResolucao, respostaDeFalhaTemporaria } from "@/modules/redirects/resposta";

interface Contexto {
  params: Promise<{ codigo: string }>;
}

/** Um formulário de ativação preenchido tem bem menos que isto. */
const TAMANHO_MAXIMO_DO_ENVIO_BYTES = 16 * 1024;
const MUITAS_TENTATIVAS = "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.";

function registrarOcorrencia(resolucao: Resolucao, codigo: string): void {
  if (resolucao.situacao === "NAO_ENCONTRADO") {
    registrarLog("aviso", "redirect.cartao_nao_encontrado", {
      motivo: resolucao.motivo,
      codigo: codigo.slice(0, 12),
    });
  } else if (resolucao.situacao === "DESTINO_INVALIDO") {
    registrarLog("erro", "redirect.destino_salvo_invalido", { cartaoId: resolucao.cartaoId });
  }
}

async function responder(contexto: Contexto, contarAcesso: boolean): Promise<Response> {
  const { codigo } = await contexto.params;

  let resolucao: Resolucao;
  try {
    const db = obterBanco();
    resolucao = await resolverRedirecionamento(db, codigo);

    // Só o cartão NÃO configurado faz esta segunda consulta: o redirecionamento não ganha nenhuma.
    if (resolucao.situacao === "NAO_CONFIGURADO" && obterConfiguracaoDeAtivacao()) {
      const paraAtivar = await buscarCartaoParaAtivar(db, codigo);
      if (paraAtivar) return paginaDeAtivacao({ codigo: paraAtivar.codigo, tipo: paraAtivar.tipo });
    }
  } catch (erro) {
    registrarLog("erro", "redirect.erro_de_banco", { mensagem: mensagemDoErro(erro) });
    return respostaDeFalhaTemporaria();
  }

  registrarOcorrencia(resolucao, codigo);

  if (resolucao.situacao === "REDIRECIONAR" && contarAcesso) {
    const { cartaoId } = resolucao;
    // Conta o acesso depois de responder, para não atrasar o redirecionamento.
    after(async () => {
      try {
        await registrarAcesso(obterBanco(), cartaoId);
      } catch (erro) {
        registrarLog("erro", "redirect.falha_ao_contar_acesso", { mensagem: mensagemDoErro(erro) });
      }
    });
  }

  return respostaDaResolucao(resolucao);
}

export function GET(_requisicao: Request, contexto: Contexto): Promise<Response> {
  return responder(contexto, true);
}

export function HEAD(_requisicao: Request, contexto: Contexto): Promise<Response> {
  return responder(contexto, false);
}

/** Lê o formulário enviado (application/x-www-form-urlencoded), com limite de tamanho. */
async function lerFormulario(requisicao: Request): Promise<Record<string, string> | null> {
  const tipo = requisicao.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  if (Number(requisicao.headers.get("content-length") ?? "0") > TAMANHO_MAXIMO_DO_ENVIO_BYTES) return null;
  const texto = await requisicao.text();
  if (texto.length > TAMANHO_MAXIMO_DO_ENVIO_BYTES) return null;

  const campos: Record<string, string> = {};
  for (const [nome, valor] of new URLSearchParams(texto)) {
    if (!(nome in campos)) campos[nome] = valor;
  }
  return campos;
}

/** Um formulário enviado por outro site não é aceito. */
function vemDeOutroSite(requisicao: Request): boolean {
  const origem = requisicao.headers.get("origin");
  if (!origem || origem === "null") return false;
  try {
    const servidor = requisicao.headers.get("x-forwarded-host") ?? requisicao.headers.get("host");
    return new URL(origem).host !== (servidor ?? new URL(requisicao.url).host);
  } catch {
    return true;
  }
}

/** O que mostrar quando o cartão não pode (ou não pode mais) ser ativado pelo cliente. */
async function respostaSemAtivacao(db: Banco, codigo: string, emJson: boolean): Promise<Response> {
  // O script da página recarrega e passa a ver o estado atual do cartão.
  if (emJson) return respostaEmJson({ ok: false, recarregar: true }, 409);
  const resolucao = await resolverRedirecionamento(db, codigo);
  if (resolucao.situacao === "REDIRECIONAR") {
    // Reenvio do formulário depois de ativado: só informa, sem alterar nada.
    const whatsapp = obterConfiguracaoDeAtivacao()?.whatsappDeAtendimento ?? null;
    return paginaDeCartaoAtivado({ codigo, whatsappDeAtendimento: whatsapp, quando: "outro" }, 409);
  }
  return respostaDaResolucao(resolucao);
}

export async function POST(requisicao: Request, contexto: Contexto): Promise<Response> {
  const codigo = normalizarCodigo((await contexto.params).codigo);
  if (!codigo) return respostaDaResolucao({ situacao: "NAO_ENCONTRADO", motivo: "CODIGO_INVALIDO" });
  if (vemDeOutroSite(requisicao)) {
    return paginaDeAviso("Não foi possível continuar", "Abra o cartão de novo e tente outra vez.", 403);
  }

  const formulario = await lerFormulario(requisicao).catch(() => null);
  if (!formulario) {
    return paginaDeAviso("Não foi possível continuar", "Abra o cartão de novo e tente outra vez.", 400);
  }
  const conferencia = formulario.acao === "conferir";

  try {
    const db = obterBanco();

    // 1. Limite de tentativas, por IP e por cartão, guardado no banco.
    const ip = ipAddress(requisicao);
    const finalidade = conferencia ? "conferencia" : "envio";
    const [porIp, porCartao] = await Promise.all([
      registrarTentativa(
        db,
        chaveDoIp(finalidade, ip, obterAuthSecret()),
        conferencia ? LIMITES_DA_ATIVACAO.conferenciaPorIp : LIMITES_DA_ATIVACAO.envioPorIp,
      ),
      registrarTentativa(
        db,
        chaveDoCartao(finalidade, codigo),
        conferencia ? LIMITES_DA_ATIVACAO.conferenciaPorCartao : LIMITES_DA_ATIVACAO.envioPorCartao,
      ),
    ]);
    if (!porIp.permitido || !porCartao.permitido) {
      registrarLog("aviso", "ativacao.limite_de_tentativas", { codigo, porIp: !porIp.permitido, conferencia });
      return conferencia
        ? respostaEmJson({ ok: false, mensagem: MUITAS_TENTATIVAS }, 429, { "Retry-After": "600" })
        : paginaDeAviso("Muitas tentativas", MUITAS_TENTATIVAS, 429, { "Retry-After": "600" });
    }

    // 2. Campo invisível preenchido: é um robô. Nada é conferido nem gravado.
    if ((formulario[CAMPO_ISCA] ?? "") !== "") {
      registrarLog("aviso", "ativacao.envio_de_robo", { codigo });
      return conferencia
        ? respostaEmJson({ ok: false, mensagem: "Não deu certo agora. Tente de novo." }, 400)
        : paginaDeAviso("Não foi possível ativar", "Abra o cartão de novo e tente outra vez.", 400);
    }

    // 3. O cartão ainda pode ser ativado pelo cliente?
    const configuracao = obterConfiguracaoDeAtivacao();
    const cartao = configuracao ? await buscarCartaoParaAtivar(db, codigo) : null;
    if (!configuracao || !cartao) return respostaSemAtivacao(db, codigo, conferencia);

    // 4. Conferência de um passo: só valida e responde. Não grava nada.
    if (conferencia) {
      const ate = formulario.ate === "1" ? 1 : formulario.ate === "2" ? 2 : 3;
      const { erros, linkExibido } = conferirPasso(formulario, cartao.tipo, ate);
      return Object.keys(erros).length > 0
        ? respostaEmJson({ ok: false, erros }, 422)
        : respostaEmJson({ ok: true, link: linkExibido });
    }

    // 5. Envio final: valida tudo de novo e ativa, em uma única transação.
    const validacao = validarAtivacao(formulario, cartao.tipo);
    if (!validacao.ok) {
      return paginaDeAtivacao(
        { codigo, tipo: cartao.tipo, valores: formulario, erros: validacao.erros, passoInicial: validacao.passo },
        422,
      );
    }
    const ativacao = await ativarPeloCliente(db, codigo, validacao.dados, VERSAO_DO_TEXTO_DE_PRIVACIDADE);
    if (ativacao.resultado === "INDISPONIVEL") return respostaSemAtivacao(db, codigo, false);
    if (ativacao.resultado === "JA_ATIVADO") {
      return paginaDeCartaoAtivado(
        { codigo, whatsappDeAtendimento: configuracao.whatsappDeAtendimento, quando: "outro" },
        409,
      );
    }

    // Nada de dados pessoais no log: só o cartão, o lote e o identificador do contato.
    registrarLog("info", "ativacao.cartao_ativado_pelo_cliente", {
      codigo,
      lote: cartao.loteIdentificador,
      tipo: cartao.tipo,
      contatoId: ativacao.contato.id,
      aceitouOfertas: ativacao.contato.aceitouOfertas,
    });
    after(async () => {
      try {
        await limparLimitesVencidos(obterBanco());
      } catch (erro) {
        registrarLog("erro", "ativacao.falha_ao_limpar_limites", { mensagem: mensagemDoErro(erro) });
      }
    });
    return paginaDeCartaoAtivado({
      codigo,
      whatsappDeAtendimento: configuracao.whatsappDeAtendimento,
      linkExibido: validacao.dados.linkExibido,
      quando: "agora",
    });
  } catch (erro) {
    registrarLog("erro", "ativacao.erro", { mensagem: mensagemDoErro(erro) });
    return conferencia
      ? respostaEmJson({ ok: false, mensagem: "Não deu certo agora. Tente de novo em instantes." }, 503)
      : respostaDeFalhaTemporaria();
  }
}
