import type { Metadata } from "next";
import { obterBanco } from "@/db/cliente";
import { Painel } from "@/components/ui";
import { exigirAdmin } from "@/modules/auth/sessao";
import { resumirCartao } from "@/modules/cards/apresentacao";
import { extrairCodigo } from "@/modules/cards/codigo";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { AtivacaoRapida } from "./ativacao-rapida";

export const metadata: Metadata = { title: "Ativar cartão — Cartões NFC" };

export default async function PaginaDeAtivacao({ searchParams }: PageProps<"/admin/ativar">) {
  await exigirAdmin();

  // Permite chegar com o cartão já escolhido: /admin/ativar?codigo=K8M4T2
  const parametro = (await searchParams).codigo;
  const codigo = extrairCodigo(Array.isArray(parametro) ? parametro[0] : parametro);
  const cartao = codigo ? await buscarCartaoPorCodigo(obterBanco(), codigo) : null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Ativar cartão</h1>
      <Painel>
        <AtivacaoRapida key={cartao?.codigo ?? "novo"} cartaoInicial={cartao ? resumirCartao(cartao) : null} />
      </Painel>
    </div>
  );
}
