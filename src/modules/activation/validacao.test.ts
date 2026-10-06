import { describe, expect, it } from "vitest";
import { validarLinkDoCliente } from "./link";
import { conferirPasso, validarAtivacao } from "./validacao";
import { formatarWhatsApp, linkDoWhatsApp, normalizarWhatsApp } from "./whatsapp";

const COMPLETO = {
  loja: "Padaria do Zé",
  ramo: "RESTAURANTE",
  nome: "José da Silva",
  papel: "DONO",
  decisor: "",
  whatsapp: "(11) 91234-5678",
  ofertas: "sim",
  link: "@padariadoze",
};

describe("WhatsApp", () => {
  it("aceita celular com 9 dígitos, em qualquer formatação, e guarda com +55", () => {
    for (const entrada of [
      "(11) 91234-5678",
      "11912345678",
      "11 91234 5678",
      "+55 11 91234-5678",
      "5511912345678",
      "011912345678",
      "(011) 91234-5678",
    ]) {
      expect(normalizarWhatsApp(entrada)).toEqual({ ok: true, numero: "+5511912345678" });
    }
  });

  it("aceita fixo com 8 dígitos (WhatsApp Business)", () => {
    expect(normalizarWhatsApp("(35) 3821-1234")).toEqual({ ok: true, numero: "+553538211234" });
    expect(normalizarWhatsApp("+55 21 2555-0000")).toEqual({ ok: true, numero: "+552125550000" });
  });

  it("recusa DDD que não existe", () => {
    for (const ddd of ["00", "01", "10", "20", "23", "25", "26", "29", "30", "36", "39", "40", "50", "52", "56", "60", "70", "72", "76", "78", "80", "90"]) {
      const resultado = normalizarWhatsApp(`(${ddd}) 91234-5678`);
      expect(resultado.ok, `DDD ${ddd}`).toBe(false);
    }
    expect(normalizarWhatsApp("(20) 91234-5678")).toEqual({
      ok: false,
      erro: "O DDD 20 não existe. Confira o número.",
    });
    // Todos os DDDs de capitais passam.
    for (const ddd of [11, 21, 27, 31, 41, 48, 51, 61, 62, 63, 65, 67, 68, 69, 71, 79, 81, 82, 83, 84, 85, 86, 91, 92, 95, 96, 98]) {
      expect(normalizarWhatsApp(`${ddd}912345678`).ok, `DDD ${ddd}`).toBe(true);
    }
  });

  it("recusa número incompleto, sem DDD, com formato impossível ou vazio", () => {
    for (const entrada of [
      "91234-5678", // sem DDD
      "(11) 1234-567", // curto
      "(11) 81234-5678", // celular precisa começar com 9
      "(11) 9123-4567", // 8 dígitos começando com 9 não é fixo
      "(11) 6123-4567", // fixo começa de 2 a 5
      "(11) 99999-9999", // repetido
      "(11) 912345-67890", // longo
      "abc",
    ]) {
      expect(normalizarWhatsApp(entrada).ok, entrada).toBe(false);
    }
    expect(normalizarWhatsApp("")).toEqual({ ok: false, erro: "Informe o WhatsApp com DDD." });
    expect(normalizarWhatsApp(undefined).ok).toBe(false);
  });

  it("formata para exibir e monta o link de conversa", () => {
    expect(formatarWhatsApp("+5511912345678")).toBe("(11) 91234-5678");
    expect(formatarWhatsApp("+553538211234")).toBe("(35) 3821-1234");
    expect(linkDoWhatsApp("+5511912345678")).toBe("https://wa.me/5511912345678");
    expect(linkDoWhatsApp("+5511912345678", "Olá! Cartão K8M4T2")).toBe(
      "https://wa.me/5511912345678?text=Ol%C3%A1!%20Cart%C3%A3o%20K8M4T2",
    );
  });
});

describe("link do Instagram", () => {
  it("aceita só o @ e transforma no link do perfil", () => {
    expect(validarLinkDoCliente("@minhaloja", "INSTAGRAM")).toEqual({
      ok: true,
      url: "https://www.instagram.com/minhaloja/",
      exibicao: "instagram.com/minhaloja",
    });
    expect(validarLinkDoCliente("  @minha.loja_01 ", "INSTAGRAM")).toMatchObject({
      url: "https://www.instagram.com/minha.loja_01/",
    });
    // Sem o @, quando é só uma palavra, também é o nome do perfil.
    expect(validarLinkDoCliente("minhaloja", "INSTAGRAM")).toMatchObject({ exibicao: "instagram.com/minhaloja" });
  });

  it("aceita o link completo do perfil e tira os códigos de rastreio", () => {
    for (const entrada of [
      "https://www.instagram.com/minhaloja/",
      "https://instagram.com/minhaloja",
      "instagram.com/minhaloja",
      "www.instagram.com/minhaloja?igsh=MTh4abc123&utm_source=qr",
      "https://www.instagram.com/minhaloja/?hl=pt-br",
      "Olha o perfil da loja https://www.instagram.com/minhaloja?igsh=abc",
    ]) {
      expect(validarLinkDoCliente(entrada, "INSTAGRAM"), entrada).toEqual({
        ok: true,
        url: "https://www.instagram.com/minhaloja/",
        exibicao: "instagram.com/minhaloja",
      });
    }
  });

  it("recusa link de outro site, com uma mensagem que diz o que fazer", () => {
    for (const entrada of [
      "https://www.facebook.com/minhaloja",
      "https://instagram.com.golpe.com/minhaloja",
      "https://g.page/r/abc/review",
      "javascript:alert(1)",
      "minha loja",
      "minha.loja",
    ]) {
      expect(validarLinkDoCliente(entrada, "INSTAGRAM"), entrada).toEqual({
        ok: false,
        erro: "Esse link não parece ser do Instagram. Confira e cole de novo.",
      });
    }
  });

  it("recusa link do Instagram que não é de um perfil", () => {
    for (const entrada of [
      "https://www.instagram.com/",
      "https://www.instagram.com/p/CxYz123/",
      "https://www.instagram.com/reel/CxYz123/",
      "https://www.instagram.com/explore/tags/padaria/",
      "https://www.instagram.com/accounts/login/",
    ]) {
      const resultado = validarLinkDoCliente(entrada, "INSTAGRAM");
      expect(resultado.ok, entrada).toBe(false);
      if (!resultado.ok) expect(resultado.erro).toContain("não é do perfil da loja");
    }
    expect(validarLinkDoCliente("", "INSTAGRAM")).toEqual({
      ok: false,
      erro: "Escreva o @ da sua loja ou cole o link do perfil.",
    });
  });
});

describe("link do Google", () => {
  it("aceita os formatos que o Google e o Google Maps compartilham", () => {
    const formatos = [
      ["https://g.page/r/CdEfGhIjKlMnEBM/review", "g.page/r/CdEfGhIjKlMnEBM/review"],
      ["https://maps.app.goo.gl/AbCdEfGh12345678", "maps.app.goo.gl/AbCdEfGh12345678"],
      ["https://goo.gl/maps/AbCdEfGh1234", "goo.gl/maps/AbCdEfGh1234"],
      ["https://share.google/AbCdEfGh1234", "share.google/AbCdEfGh1234"],
      ["https://g.co/kgs/AbCd12", "g.co/kgs/AbCd12"],
      ["https://search.google.com/local/writereview?placeid=ChIJabc123", "search.google.com/local/writereview"],
      ["https://www.google.com/maps/place/Padaria+do+Z%C3%A9/@-21.2,-45.0,17z", null],
      ["https://www.google.com.br/maps/place/Padaria", "google.com.br/maps/place/Padaria"],
      ["maps.app.goo.gl/AbCdEfGh12345678", "maps.app.goo.gl/AbCdEfGh12345678"],
    ] as const;
    for (const [entrada, exibicao] of formatos) {
      const resultado = validarLinkDoCliente(entrada, "GOOGLE");
      expect(resultado.ok, entrada).toBe(true);
      if (resultado.ok && exibicao) expect(resultado.exibicao).toBe(exibicao);
      if (resultado.ok) expect(resultado.url.startsWith("https://")).toBe(true);
    }
  });

  it("aceita o texto colado com o nome da loja junto do link", () => {
    expect(validarLinkDoCliente("Padaria do Zé\nhttps://maps.app.goo.gl/AbCdEfGh12345678", "GOOGLE")).toMatchObject({
      ok: true,
      url: "https://maps.app.goo.gl/AbCdEfGh12345678",
    });
  });

  it("encurta links muito longos só na hora de mostrar", () => {
    const longo = `https://www.google.com/maps/place/${"a".repeat(200)}`;
    const resultado = validarLinkDoCliente(longo, "GOOGLE");
    expect(resultado.ok && resultado.exibicao.length).toBe(60);
    expect(resultado.ok && resultado.url).toBe(longo);
  });

  it("recusa link de outro site e a página inicial do Google", () => {
    for (const entrada of ["https://www.instagram.com/minhaloja", "https://google.com.golpe.com/maps", "@minhaloja", "padaria do zé"]) {
      expect(validarLinkDoCliente(entrada, "GOOGLE"), entrada).toEqual({
        ok: false,
        erro: "Esse link não parece ser do Google. Confira e cole de novo.",
      });
    }
    expect(validarLinkDoCliente("https://www.google.com/", "GOOGLE")).toMatchObject({ ok: false });
    expect(validarLinkDoCliente("google.com", "GOOGLE")).toMatchObject({ ok: false });
    expect(validarLinkDoCliente("   ", "GOOGLE")).toEqual({ ok: false, erro: "Cole aqui o link da sua empresa no Google." });
  });
});

describe("dados de contato", () => {
  it("com tudo preenchido, devolve os dados prontos para gravar", () => {
    const resultado = validarAtivacao(COMPLETO, "INSTAGRAM");
    expect(resultado).toEqual({
      ok: true,
      dados: {
        tipo: "INSTAGRAM",
        loja: "Padaria do Zé",
        ramo: "RESTAURANTE",
        nome: "José da Silva",
        papel: "DONO",
        decisor: null,
        whatsapp: "+5511912345678",
        aceitouOfertas: true,
        link: "https://www.instagram.com/padariadoze/",
        linkExibido: "instagram.com/padariadoze",
      },
    });
  });

  it("contato é obrigatório: sem loja, nome, função ou WhatsApp não há dados para ativar", () => {
    for (const campo of ["loja", "nome", "papel", "whatsapp"] as const) {
      const resultado = validarAtivacao({ ...COMPLETO, [campo]: "" }, "INSTAGRAM");
      expect(resultado.ok, campo).toBe(false);
      if (!resultado.ok) expect(Object.keys(resultado.erros)).toEqual([campo]);
    }
    const vazio = validarAtivacao({}, "GOOGLE");
    expect(vazio).toMatchObject({
      ok: false,
      passo: 1,
      erros: {
        loja: "Escreva o nome da sua loja ou empresa.",
        nome: "Escreva o seu nome.",
        papel: "Escolha uma das opções.",
        whatsapp: "Informe o WhatsApp com DDD.",
        link: "Cole aqui o link da sua empresa no Google.",
      },
    });
  });

  it("quem não é o dono precisa dizer quem decide; o dono não", () => {
    const gerente = validarAtivacao({ ...COMPLETO, papel: "GERENTE" }, "INSTAGRAM");
    expect(gerente).toMatchObject({ ok: false, passo: 2, erros: { decisor: "Escreva o nome de quem decide as coisas na loja." } });

    const comDecisor = validarAtivacao({ ...COMPLETO, papel: "FUNCIONARIO", decisor: "  Maria   Souza " }, "INSTAGRAM");
    expect(comDecisor.ok && comDecisor.dados.decisor).toBe("Maria Souza");
    expect(comDecisor.ok && comDecisor.dados.papel).toBe("FUNCIONARIO");

    // Dono: o que vier no campo escondido é ignorado.
    const dono = validarAtivacao({ ...COMPLETO, decisor: "Alguém" }, "INSTAGRAM");
    expect(dono.ok && dono.dados.decisor).toBeNull();
  });

  it("ramo é opcional, mas precisa ser uma das opções", () => {
    const semRamo = validarAtivacao({ ...COMPLETO, ramo: "" }, "INSTAGRAM");
    expect(semRamo.ok && semRamo.dados.ramo).toBeNull();
    expect(validarAtivacao({ ...COMPLETO, ramo: "CASSINO" }, "INSTAGRAM")).toMatchObject({
      ok: false,
      erros: { ramo: "Escolha uma das opções." },
    });
  });

  it("o aceite de ofertas é opcional e só vale quando marcado de propósito", () => {
    for (const ofertas of [undefined, "", "nao", "on", "true", "1"]) {
      const resultado = validarAtivacao({ ...COMPLETO, ofertas }, "INSTAGRAM");
      expect(resultado.ok && resultado.dados.aceitouOfertas, String(ofertas)).toBe(false);
    }
    const marcado = validarAtivacao({ ...COMPLETO, ofertas: "sim" }, "INSTAGRAM");
    expect(marcado.ok && marcado.dados.aceitouOfertas).toBe(true);
  });

  it("limpa espaços e caracteres de controle, e recusa nomes sem letras ou longos demais", () => {
    const limpo = validarAtivacao({ ...COMPLETO, loja: "  Padaria \u0000 do\tZé‮ ", nome: "José\n\nSilva" }, "INSTAGRAM");
    expect(limpo.ok && limpo.dados.loja).toBe("Padaria do Zé");
    expect(limpo.ok && limpo.dados.nome).toBe("José Silva");
    expect(validarAtivacao({ ...COMPLETO, loja: "12345" }, "INSTAGRAM").ok).toBe(false);
    expect(validarAtivacao({ ...COMPLETO, loja: "A" }, "INSTAGRAM").ok).toBe(false);
    expect(validarAtivacao({ ...COMPLETO, nome: "x".repeat(81) }, "INSTAGRAM").ok).toBe(false);
    expect(validarAtivacao({ ...COMPLETO, loja: ["a", "b"] as unknown as string }, "INSTAGRAM").ok).toBe(false);
  });

  it("o link é validado conforme o tipo do cartão", () => {
    expect(validarAtivacao(COMPLETO, "GOOGLE")).toMatchObject({
      ok: false,
      passo: 3,
      erros: { link: "Esse link não parece ser do Google. Confira e cole de novo." },
    });
    const google = validarAtivacao({ ...COMPLETO, link: "https://g.page/r/abc/review" }, "GOOGLE");
    expect(google.ok && google.dados.link).toBe("https://g.page/r/abc/review");
  });
});

describe("conferência por passo", () => {
  it("cada passo só cobra os campos até ele", () => {
    expect(conferirPasso({}, "INSTAGRAM", 1).erros).toEqual({ loja: "Escreva o nome da sua loja ou empresa." });
    expect(conferirPasso({ loja: "Padaria do Zé" }, "INSTAGRAM", 1).erros).toEqual({});
    expect(Object.keys(conferirPasso({ loja: "Padaria do Zé" }, "INSTAGRAM", 2).erros)).toEqual([
      "nome",
      "papel",
      "whatsapp",
    ]);
    expect(conferirPasso({ ...COMPLETO, link: "" }, "INSTAGRAM", 2)).toEqual({ erros: {}, linkExibido: null });
    expect(Object.keys(conferirPasso({ ...COMPLETO, link: "" }, "INSTAGRAM", 3).erros)).toEqual(["link"]);
  });

  it("no passo do link, devolve como o link será mostrado na confirmação", () => {
    expect(conferirPasso(COMPLETO, "INSTAGRAM", 3)).toEqual({ erros: {}, linkExibido: "instagram.com/padariadoze" });
  });
});
