// "Como usamos seus dados": página pública, aberta a partir da ativação do cartão.
//
// RASCUNHO A REVISAR. O conteúdo fica em src/modules/activation/privacidade.ts e ainda precisa ser
// revisado por quem responde pelos dados. Esta página não afirma conformidade legal.
import type { Metadata } from "next";
import { obterConfiguracaoDeAtivacao } from "@/modules/activation/configuracao";
import { textoDePrivacidade } from "@/modules/activation/privacidade";

export const metadata: Metadata = {
  title: "Como usamos seus dados",
  robots: { index: false, follow: false },
};

// Os dados do responsável vêm de variáveis de ambiente lidas a cada requisição.
export const dynamic = "force-dynamic";

export default function PaginaDePrivacidade() {
  const configuracao = obterConfiguracaoDeAtivacao();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8 text-lg leading-relaxed text-slate-800">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-slate-900">Como usamos seus dados</h1>
      {configuracao ? (
        textoDePrivacidade(configuracao).map((secao) => (
          <section key={secao.titulo} className="mb-6">
            <h2 className="mb-2 text-xl font-semibold text-slate-900">{secao.titulo}</h2>
            {secao.paragrafos.map((paragrafo) => (
              <p key={paragrafo} className="mb-3">
                {paragrafo}
              </p>
            ))}
          </section>
        ))
      ) : (
        <p>Esta página ainda não está disponível.</p>
      )}
    </main>
  );
}
