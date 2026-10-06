// Texto "Como usamos seus dados", exibido na ativação do cartão.
//
// ATENÇÃO: ESTE TEXTO É UM RASCUNHO. Ele ainda precisa ser revisado por quem responde pelos dados
// (de preferência com apoio jurídico) antes de ser tratado como definitivo. O sistema não afirma
// conformidade com a LGPD: ele só registra, em cada contato, qual versão do texto foi mostrada.
//
// Ao mudar o texto, mude também a VERSAO: é ela que fica gravada junto com o aceite de cada pessoa.
import type { ConfiguracaoDeAtivacao } from "./configuracao";
import { formatarWhatsApp } from "./whatsapp";

export const VERSAO_DO_TEXTO_DE_PRIVACIDADE = "2026-10-06-rascunho-1";

/** Prazo de guarda proposto no rascunho, contado a partir do último contato com a pessoa. */
export const PRAZO_DE_GUARDA_EM_ANOS = 2;

export interface SecaoDoTexto {
  titulo: string;
  paragrafos: string[];
}

export function textoDePrivacidade(configuracao: ConfiguracaoDeAtivacao): SecaoDoTexto[] {
  const { responsavel } = configuracao;
  const whatsapp = formatarWhatsApp(configuracao.whatsappDeAtendimento);
  return [
    {
      titulo: "Quem cuida dos seus dados",
      paragrafos: [
        `${responsavel.nome}, ${responsavel.documento}. Para falar sobre os seus dados, escreva para ${responsavel.email} ou chame no WhatsApp ${whatsapp}.`,
      ],
    },
    {
      titulo: "Quais dados pedimos",
      paragrafos: [
        "O nome da sua loja, o ramo do negócio (se você quiser informar), o seu nome, a sua função na loja, o nome de quem decide as coisas por lá e um WhatsApp para contato.",
        "Também guardamos o link que você escolheu para o cartão e a data em que ele foi ativado.",
      ],
    },
    {
      titulo: "Para que usamos",
      paragrafos: [
        "Para dar suporte ao seu cartão: confirmar a ativação, trocar o link quando você pedir e avisar se houver algum problema com ele.",
        "Só se você marcar a opção de receber mensagens, também usamos o seu WhatsApp para contar novidades e oferecer outros produtos. Você pode desmarcar isso a qualquer momento: é só pedir.",
        "Não vendemos nem repassamos os seus dados para outras empresas.",
      ],
    },
    {
      titulo: "Por quanto tempo guardamos",
      paragrafos: [
        `Enquanto o seu cartão estiver em uso e por até ${PRAZO_DE_GUARDA_EM_ANOS} anos depois do nosso último contato. Passado esse prazo, ou antes disso se você pedir, os dados são apagados.`,
      ],
    },
    {
      titulo: "Como pedir para ver, corrigir ou apagar",
      paragrafos: [
        `Escreva para ${responsavel.email} ou chame no WhatsApp ${whatsapp}. Você pode pedir para ver os seus dados, corrigir alguma informação, parar de receber mensagens ou apagar tudo.`,
        "Apagar os seus dados não desativa o cartão: ele continua funcionando normalmente.",
      ],
    },
  ];
}
