import { describe, expect, it } from "vitest";
import { obterConfiguracaoDeAtivacao, pendenciasDaConfiguracao } from "./configuracao";
import { textoDePrivacidade } from "./privacidade";

const env = (valores: Record<string, string>) => valores as unknown as NodeJS.ProcessEnv;
const COMPLETA = {
  ATENDIMENTO_WHATSAPP: "35999990000",
  RESPONSAVEL_DADOS_NOME: "Maria de Exemplo",
  RESPONSAVEL_DADOS_EMAIL: "dados@exemplo.com.br",
};

describe("configuração do atendimento", () => {
  it("WhatsApp, nome e e-mail são obrigatórios", () => {
    expect(pendenciasDaConfiguracao(env({}))).toHaveLength(3);
    expect(obterConfiguracaoDeAtivacao(env({}))).toBeNull();
    for (const variavel of Object.keys(COMPLETA)) {
      const semUma = { ...COMPLETA, [variavel]: " " };
      expect(pendenciasDaConfiguracao(env(semUma)).join()).toContain(variavel);
      expect(obterConfiguracaoDeAtivacao(env(semUma))).toBeNull();
    }
  });

  it("recusa WhatsApp e e-mail em formato inválido", () => {
    expect(pendenciasDaConfiguracao(env({ ...COMPLETA, ATENDIMENTO_WHATSAPP: "12345" }))).toEqual([
      "ATENDIMENTO_WHATSAPP (o número informado não é válido)",
    ]);
    expect(pendenciasDaConfiguracao(env({ ...COMPLETA, RESPONSAVEL_DADOS_EMAIL: "sem-arroba" }))).toHaveLength(1);
  });

  it("guarda o WhatsApp com +55, em qualquer formato digitado", () => {
    for (const numero of ["35999990000", "(35) 99999-0000", "+55 35 99999-0000"]) {
      expect(obterConfiguracaoDeAtivacao(env({ ...COMPLETA, ATENDIMENTO_WHATSAPP: numero }))?.whatsappDeAtendimento).toBe(
        "+5535999990000",
      );
    }
  });

  it("o CNPJ/CPF é opcional: sem ele, o texto de privacidade sai sem documento", () => {
    const semDocumento = obterConfiguracaoDeAtivacao(env(COMPLETA));
    expect(pendenciasDaConfiguracao(env(COMPLETA))).toEqual([]);
    expect(semDocumento?.responsavel).toEqual({ nome: "Maria de Exemplo", documento: null, email: "dados@exemplo.com.br" });
    const [quem] = textoDePrivacidade(semDocumento!);
    expect(quem.paragrafos[0]).toBe(
      "Maria de Exemplo. Para falar sobre os seus dados, escreva para dados@exemplo.com.br ou chame no WhatsApp (35) 99999-0000.",
    );

    const comDocumento = obterConfiguracaoDeAtivacao(env({ ...COMPLETA, RESPONSAVEL_DADOS_DOCUMENTO: "CPF 000.000.000-00" }));
    expect(textoDePrivacidade(comDocumento!)[0].paragrafos[0]).toContain("Maria de Exemplo, CPF 000.000.000-00.");
  });

  it("o texto diz para que servem os dados, por quanto tempo ficam e como pedir a exclusão", () => {
    const texto = textoDePrivacidade(obterConfiguracaoDeAtivacao(env(COMPLETA))!);
    expect(texto.map((secao) => secao.titulo)).toEqual([
      "Quem cuida dos seus dados",
      "Quais dados pedimos",
      "Para que usamos",
      "Por quanto tempo guardamos",
      "Como pedir para ver, corrigir ou apagar",
    ]);
    const tudo = texto.flatMap((secao) => secao.paragrafos).join(" ");
    expect(tudo).toContain("Só se você marcar a opção de receber mensagens");
    expect(tudo).toContain("por até 2 anos depois do nosso último contato");
    expect(tudo).toContain("Apagar os seus dados não desativa o cartão");
    // Rascunho: o texto não promete conformidade legal.
    expect(tudo).not.toMatch(/LGPD|conformidade|de acordo com a lei/i);
  });
});
