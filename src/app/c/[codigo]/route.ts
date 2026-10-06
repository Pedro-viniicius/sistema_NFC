// Rota pública do cartão: GET /c/[codigo]
// Route Handler puro (sem React): uma consulta ao banco e um 302.
import { after } from "next/server";
import { obterBanco } from "@/db/cliente";
import { mensagemDoErro, registrarLog } from "@/lib/log";
import { registrarAcesso } from "@/modules/cards/repositorio";
import { resolverRedirecionamento, type Resolucao } from "@/modules/redirects/resolver";
import { respostaDaResolucao, respostaDeFalhaTemporaria } from "@/modules/redirects/resposta";

interface Contexto {
  params: Promise<{ codigo: string }>;
}

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
    resolucao = await resolverRedirecionamento(obterBanco(), codigo);
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
