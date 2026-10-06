// Ativação do cartão pelo próprio cliente, na URL permanente (/c/CODIGO), de ponta a ponta:
// rota de verdade, banco de verdade (PGlite + migrações), validação e limites de verdade.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cartoes, contatos, limitesDeTentativas, lotes } from "@/db/schema";
import type { Banco } from "@/db/tipos";
import { LIMITES_DA_ATIVACAO, limparLimitesVencidos, registrarTentativa } from "@/modules/activation/limite";
import { VERSAO_DO_TEXTO_DE_PRIVACIDADE } from "@/modules/activation/privacidade";
import * as servicoDeAtivacao from "@/modules/activation/servico";
import { ativarPeloCliente, definirAtivacaoPeloCliente } from "@/modules/activation/servico";
import { validarAtivacao } from "@/modules/activation/validacao";
import { criarLote, excluirLote } from "@/modules/batches/servico";
import { buscarCartaoPorCodigo } from "@/modules/cards/repositorio";
import { configurarDestino, desativarCartao } from "@/modules/cards/servico";
import { criarBancoDeTeste } from "./banco-de-teste";

const estado = vi.hoisted(() => ({
  db: undefined as unknown,
  pendentes: [] as Array<() => Promise<void>>,
}));

vi.mock("@/db/cliente", () => ({ obterBanco: () => estado.db }));
vi.mock("next/server", () => ({
  after: (tarefa: () => Promise<void>) => {
    estado.pendentes.push(tarefa);
  },
}));

import { GET, HEAD, POST } from "@/app/c/[codigo]/route";

const BASE = "https://go.example.com";

const CONTATO = {
  loja: "Padaria do Zé",
  ramo: "RESTAURANTE",
  nome: "José da Silva",
  papel: "DONO",
  decisor: "",
  whatsapp: "(11) 91234-5678",
  link: "@padariadoze",
};

let db: Banco;
let sequencia = 0;
let ipDaVez = 0;

function configurarAtendimento(): void {
  vi.stubEnv("ATENDIMENTO_WHATSAPP", "(35) 99999-0000");
  vi.stubEnv("RESPONSAVEL_DADOS_NOME", "Empresa de Teste Ltda.");
  vi.stubEnv("RESPONSAVEL_DADOS_DOCUMENTO", "CNPJ 00.000.000/0001-00");
  vi.stubEnv("RESPONSAVEL_DADOS_EMAIL", "dados@exemplo.com.br");
}

/** Códigos válidos e únicos para os testes (o alfabeto não tem 0, 1, I, L nem O). */
function novoCodigo(): string {
  const alfabeto = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let numero = ++sequencia;
  let sufixo = "";
  for (let i = 0; i < 4; i++) {
    sufixo = alfabeto[numero % alfabeto.length] + sufixo;
    numero = Math.floor(numero / alfabeto.length);
  }
  return `AT${sufixo}`;
}

interface OpcoesDoLote {
  tipo?: "INSTAGRAM" | "GOOGLE" | "GENERICO" | null;
  liberado?: boolean;
  quantidade?: number;
}

/** Cria um lote e devolve os códigos dos cartões. */
async function criarCartoes(opcoes: OpcoesDoLote = {}): Promise<{ identificador: string; codigos: string[] }> {
  const quantidade = opcoes.quantidade ?? 1;
  const codigos = Array.from({ length: quantidade }, novoCodigo);
  const fila = [...codigos];
  const tipo = opcoes.tipo === undefined ? "INSTAGRAM" : opcoes.tipo;
  const { lote } = await criarLote(db, { quantidade, tipo, descricao: null }, { gerarCodigo: () => fila.shift()! });
  if (opcoes.liberado ?? true) await definirAtivacaoPeloCliente(db, lote.identificador, true, []);
  return { identificador: lote.identificador, codigos };
}

async function umCartao(opcoes: OpcoesDoLote = {}): Promise<string> {
  return (await criarCartoes(opcoes)).codigos[0];
}

const contexto = (codigo: string) => ({ params: Promise.resolve({ codigo }) });
const abrir = (codigo: string) => GET(new Request(`${BASE}/c/${codigo}`), contexto(codigo));

interface OpcoesDoEnvio {
  ip?: string;
  cabecalhos?: Record<string, string>;
}

function enviar(codigo: string, campos: Record<string, string>, opcoes: OpcoesDoEnvio = {}): Promise<Response> {
  return POST(
    new Request(`${BASE}/c/${codigo}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Cada envio vem de um IP diferente, a menos que o teste peça outro: assim o limite por IP
        // de um teste não interfere nos demais.
        "x-real-ip": opcoes.ip ?? `198.51.100.${(++ipDaVez % 250) + 1}`,
        ...opcoes.cabecalhos,
      },
      body: new URLSearchParams(campos).toString(),
    }),
    contexto(codigo),
  );
}

const conferir = (codigo: string, campos: Record<string, string>, ate: number, opcoes?: OpcoesDoEnvio) =>
  enviar(codigo, { ...campos, acao: "conferir", ate: String(ate) }, opcoes);

/** Retrato de tudo o que a página pública poderia alterar. */
async function retrato(codigo: string) {
  const cartao = await buscarCartaoPorCodigo(db, codigo);
  return {
    cartao: cartao && { ...cartao },
    contatos: await db.select().from(contatos),
    limites: await db.select().from(limitesDeTentativas),
  };
}

/** Só o texto que a pessoa lê: sem script, estilo nem marcação. */
function textoVisivel(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

beforeAll(async () => {
  db = await criarBancoDeTeste();
  estado.db = db;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  vi.unstubAllEnvs();
  configurarAtendimento();
  estado.pendentes.length = 0;
});

describe("abrir /c/CODIGO", () => {
  it("cartão não configurado de lote liberado: mostra o início da ativação", async () => {
    const codigo = await umCartao({ tipo: "INSTAGRAM" });
    const resposta = await abrir(codigo);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    expect(resposta.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const html = await resposta.text();
    const texto = textoVisivel(html);
    expect(texto).toContain("Vamos ativar o seu cartão");
    expect(texto).toContain("Leva menos de 1 minuto.");
    expect(texto).toContain("Este é um cartão de Instagram");
    expect(texto).toContain("Passo 1 de 4");
    expect(texto).toContain("Aceito receber mensagens no WhatsApp sobre novidades e outros produtos");
    expect(texto).toContain("Como usamos seus dados");
    expect(texto).toContain("Depois de ativar, para trocar o link é só falar com a gente.");
    expect(html).toContain(`action="/c/${codigo}"`);
    // A caixa de ofertas começa desmarcada.
    expect(html).toMatch(/<input type="checkbox" name="ofertas" value="sim">/);
  });

  it("diz se o cartão é de Instagram ou de Google, e ensina a achar o link do Google", async () => {
    const google = textoVisivel(await (await abrir(await umCartao({ tipo: "GOOGLE" }))).text());
    expect(google).toContain("cartão de avaliações no Google");
    expect(google).toContain("Como achar o link pelo celular");
    expect(google).toContain("Copiar link");
    const instagram = textoVisivel(await (await abrir(await umCartao({ tipo: "INSTAGRAM" }))).text());
    expect(instagram).toContain("@ da loja");
    expect(instagram).not.toContain("Google Maps");
  });

  it("abrir a página (GET ou HEAD) não altera nada, quantas vezes for", async () => {
    const codigo = await umCartao();
    const antes = await retrato(codigo);
    for (let i = 0; i < 5; i++) {
      await abrir(codigo);
      await HEAD(new Request(`${BASE}/c/${codigo}`, { method: "HEAD" }), contexto(codigo));
    }
    for (const tarefa of estado.pendentes.splice(0)) await tarefa();
    expect(await retrato(codigo)).toEqual(antes);
    expect(antes.cartao?.status).toBe("NAO_CONFIGURADO");
    expect(antes.cartao?.totalAcessos).toBe(0);
  });

  it("cartão configurado redireciona igual a antes, sem nenhuma consulta a mais", async () => {
    const codigo = await umCartao();
    await configurarDestino(db, { codigo, tipo: "INSTAGRAM", destinoUrl: "https://instagram.com/empresa" });
    const consultaDaAtivacao = vi.spyOn(servicoDeAtivacao, "buscarCartaoParaAtivar");

    const resposta = await abrir(codigo);
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("Location")).toBe("https://instagram.com/empresa");
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    expect(await resposta.text()).toBe("");
    expect(consultaDaAtivacao).not.toHaveBeenCalled();

    // (O espião funciona: ao abrir um cartão NÃO configurado, a consulta extra acontece uma vez.)
    await abrir(await umCartao());
    expect(consultaDaAtivacao).toHaveBeenCalledTimes(1);
    consultaDaAtivacao.mockRestore();
  });

  it("lote sem a opção, cartão sem lote e lote de outro tipo: a página de sempre", async () => {
    const semOpcao = await umCartao({ liberado: false });
    const { identificador, codigos } = await criarCartoes({ tipo: "GENERICO", liberado: false });
    // Mesmo que alguém ligue a opção direto no banco, um lote sem tipo de Instagram/Google não ativa.
    await db.update(lotes).set({ ativacaoPeloCliente: true }).where(eq(lotes.identificador, identificador));

    for (const codigo of [semOpcao, codigos[0]]) {
      const resposta = await abrir(codigo);
      expect(resposta.status).toBe(200);
      const texto = textoVisivel(await resposta.text());
      expect(texto).toContain("Cartão ainda não configurado");
      expect(texto).not.toContain("Vamos ativar");
    }
  });

  it("cartão inativo e código inexistente: comportamento atual", async () => {
    const inativo = await umCartao();
    await desativarCartao(db, inativo);
    expect((await abrir(inativo)).status).toBe(410);
    expect((await abrir("ZZZZZ9")).status).toBe(404);
    expect((await abrir("TESTE0")).status).toBe(404);
  });

  it("sem o atendimento configurado, a ativação pelo cliente não aparece", async () => {
    const codigo = await umCartao();
    vi.stubEnv("ATENDIMENTO_WHATSAPP", "");
    const texto = textoVisivel(await (await abrir(codigo)).text());
    expect(texto).toContain("Cartão ainda não configurado");
    expect((await enviar(codigo, CONTATO)).status).toBe(200);
    expect((await buscarCartaoPorCodigo(db, codigo))?.status).toBe("NAO_CONFIGURADO");
  });

  it("nenhuma resposta da rota fica em cache", async () => {
    const liberado = await umCartao();
    const ativado = await umCartao();
    await enviar(ativado, CONTATO);
    const respostas = await Promise.all([
      abrir(liberado),
      abrir(ativado),
      abrir(await umCartao({ liberado: false })),
      abrir("ZZZZZ9"),
      conferir(liberado, CONTATO, 3),
      conferir(liberado, {}, 1),
      enviar(liberado, { ...CONTATO, nome: "" }),
      enviar(ativado, CONTATO),
      enviar(liberado, { ...CONTATO, empresa_site: "http://spam.example" }),
    ]);
    for (const resposta of respostas) {
      expect(resposta.headers.get("Cache-Control"), String(resposta.status)).toBe("no-store");
    }
  });
});

describe("conferência de cada passo (não grava nada)", () => {
  it("devolve os erros do passo em mensagens que dizem o que fazer", async () => {
    const codigo = await umCartao();
    const antes = await retrato(codigo);

    const passo1 = await conferir(codigo, {}, 1);
    expect(passo1.status).toBe(422);
    expect(await passo1.json()).toEqual({ ok: false, erros: { loja: "Escreva o nome da sua loja ou empresa." } });

    const passo2 = await conferir(codigo, { loja: "Padaria do Zé", whatsapp: "(20) 91234-5678" }, 2);
    expect(await passo2.json()).toEqual({
      ok: false,
      erros: {
        nome: "Escreva o seu nome.",
        papel: "Escolha uma das opções.",
        whatsapp: "O DDD 20 não existe. Confira o número.",
      },
    });

    const passo3 = await conferir(codigo, { ...CONTATO, link: "https://facebook.com/padaria" }, 3);
    expect(await passo3.json()).toEqual({
      ok: false,
      erros: { link: "Esse link não parece ser do Instagram. Confira e cole de novo." },
    });

    const depois = await retrato(codigo);
    expect(depois.cartao).toEqual(antes.cartao);
    expect(depois.contatos).toEqual(antes.contatos);
  });

  it("com tudo certo, devolve o link como será mostrado na confirmação", async () => {
    const codigo = await umCartao();
    const resposta = await conferir(codigo, CONTATO, 3);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, link: "instagram.com/padariadoze" });
    expect((await buscarCartaoPorCodigo(db, codigo))?.status).toBe("NAO_CONFIGURADO");
  });
});

describe("envio final", () => {
  it("ativa o cartão, grava o contato e o redirecionamento vale na hora", async () => {
    const { identificador, codigos } = await criarCartoes({ tipo: "INSTAGRAM" });
    const [codigo] = codigos;
    const antes = Date.now();

    const resposta = await enviar(codigo, { ...CONTATO, papel: "GERENTE", decisor: "Maria Souza", ofertas: "sim" });
    expect(resposta.status).toBe(200);
    const html = await resposta.text();
    const texto = textoVisivel(html);
    expect(texto).toContain("Cartão ativado!");
    expect(texto).toContain("instagram.com/padariadoze");
    expect(texto).toContain("Testar agora");
    expect(texto).toContain("Precisa trocar o link? Fale com a gente");
    expect(html).toContain(`href="/c/${codigo}"`);
    // O botão de falar com a gente abre o WhatsApp do administrador, já com o código do cartão.
    expect(html).toContain("https://wa.me/5535999990000?text=");
    expect(html).toContain(encodeURIComponent(`cartão ${codigo}`));

    const cartao = await buscarCartaoPorCodigo(db, codigo);
    expect(cartao).toMatchObject({
      status: "ATIVO",
      tipo: "INSTAGRAM",
      destinoUrl: "https://www.instagram.com/padariadoze/",
      codigo,
    });
    expect(cartao?.ativadoEm?.getTime()).toBeGreaterThanOrEqual(antes);

    const [contato] = await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo));
    expect(contato).toMatchObject({
      cartaoId: cartao?.id,
      cartaoCodigo: codigo,
      loteIdentificador: identificador,
      tipo: "INSTAGRAM",
      loja: "Padaria do Zé",
      ramo: "RESTAURANTE",
      nome: "José da Silva",
      papel: "GERENTE",
      decisor: "Maria Souza",
      whatsapp: "+5511912345678",
      aceitouOfertas: true,
      versaoDoTexto: VERSAO_DO_TEXTO_DE_PRIVACIDADE,
      situacao: "NOVO",
      observacao: null,
    });
    expect(contato.registradoEm.getTime()).toBeGreaterThanOrEqual(antes);

    // "Testar agora": a URL permanente já redireciona.
    const teste = await abrir(codigo);
    expect(teste.status).toBe(302);
    expect(teste.headers.get("Location")).toBe("https://www.instagram.com/padariadoze/");
  });

  it("sem marcar a caixa, o aceite de ofertas fica registrado como não", async () => {
    const codigo = await umCartao({ tipo: "GOOGLE" });
    const resposta = await enviar(codigo, { ...CONTATO, link: "https://g.page/r/CdEfGh/review" });
    expect(resposta.status).toBe(200);
    const [contato] = await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo));
    expect(contato.aceitouOfertas).toBe(false);
    expect(contato.versaoDoTexto).toBe(VERSAO_DO_TEXTO_DE_PRIVACIDADE);
    expect(contato.tipo).toBe("GOOGLE");
    expect((await buscarCartaoPorCodigo(db, codigo))?.destinoUrl).toBe("https://g.page/r/CdEfGh/review");
  });

  it("sem os dados de contato obrigatórios, o cartão não é ativado", async () => {
    const codigo = await umCartao();
    for (const campo of ["loja", "nome", "papel", "whatsapp", "link"] as const) {
      const resposta = await enviar(codigo, { ...CONTATO, [campo]: "" });
      expect(resposta.status, campo).toBe(422);
    }
    // Um envio "na mão", só com o link, também não ativa.
    expect((await enviar(codigo, { link: "@padariadoze" })).status).toBe(422);

    const depois = await retrato(codigo);
    expect(depois.cartao).toMatchObject({ status: "NAO_CONFIGURADO", destinoUrl: null });
    expect(depois.contatos.filter((contato) => contato.cartaoCodigo === codigo)).toEqual([]);
  });

  it("devolve o formulário com o que já foi digitado e os erros, no passo certo", async () => {
    const codigo = await umCartao();
    const resposta = await enviar(codigo, { ...CONTATO, whatsapp: "(11) 1234", ofertas: "sim" });
    expect(resposta.status).toBe(422);
    const html = await resposta.text();
    expect(html).toContain('data-passo-inicial="2"');
    expect(html).toContain("data-do-servidor");
    expect(html).toContain('name="loja" maxlength="80" autocomplete="organization" autocapitalize="words" value="Padaria do Zé"');
    expect(html).toContain('value="(11) 1234" aria-invalid="true"');
    expect(html).toContain('<option value="RESTAURANTE" selected>');
    expect(html).toContain('name="papel" value="DONO" checked');
    expect(html).toContain('name="ofertas" value="sim" checked');
    expect(textoVisivel(html)).toContain("Confira o número: DDD e telefone, como (11) 91234-5678.");
  });

  it("o que a pessoa digita nunca vira HTML ou script na página", async () => {
    const codigo = await umCartao();
    const ataque = `"><script>alert(1)</script><img src=x onerror=alert(2)>'`;
    const resposta = await enviar(codigo, { ...CONTATO, loja: ataque, nome: ataque, link: ataque, whatsapp: ataque });
    const html = await resposta.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    // Scripts e estilos só rodam com o código de uso único da resposta.
    const csp = resposta.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("form-action 'self'");
  });
});

describe("depois de ativado, a página pública não altera mais nada", () => {
  it("reenvio do formulário e requisição montada à mão são recusados", async () => {
    const codigo = await umCartao();
    expect((await enviar(codigo, CONTATO)).status).toBe(200);
    const antes = await retrato(codigo);

    // Reenvio (atualizar a página final) e tentativa de trocar o link e o contato.
    const reenvio = await enviar(codigo, CONTATO);
    const troca = await enviar(codigo, { ...CONTATO, loja: "Outra loja", link: "@golpista", whatsapp: "(21) 98888-7777" });
    for (const resposta of [reenvio, troca]) {
      expect(resposta.status).toBe(409);
      const texto = textoVisivel(await resposta.text());
      expect(texto).toContain("Este cartão acabou de ser ativado.");
      expect(texto).not.toContain("golpista");
    }
    // A conferência também não devolve mais nada do formulário.
    const conferencia = await conferir(codigo, { ...CONTATO, link: "@golpista" }, 3);
    expect(conferencia.status).toBe(409);
    expect(await conferencia.json()).toEqual({ ok: false, recarregar: true });

    const depois = await retrato(codigo);
    expect(depois.cartao).toEqual(antes.cartao);
    expect(depois.contatos).toEqual(antes.contatos);
    expect(depois.cartao?.destinoUrl).toBe("https://www.instagram.com/padariadoze/");
  });

  it("cartão ativado pelo painel também não pode ser mexido pela página pública", async () => {
    const codigo = await umCartao();
    await configurarDestino(db, { codigo, tipo: "INSTAGRAM", destinoUrl: "https://instagram.com/original" });
    expect((await enviar(codigo, CONTATO)).status).toBe(409);
    expect((await buscarCartaoPorCodigo(db, codigo))?.destinoUrl).toBe("https://instagram.com/original");
    expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo))).toEqual([]);
  });

  it("lote sem a opção, cartão inativo e código inexistente: o envio não faz nada", async () => {
    const semOpcao = await umCartao({ liberado: false });
    const inativo = await umCartao();
    await desativarCartao(db, inativo);

    const respostas = {
      semOpcao: await enviar(semOpcao, CONTATO),
      inativo: await enviar(inativo, CONTATO),
      inexistente: await enviar("ZZZZZ9", CONTATO),
      invalido: await enviar("TESTE0", CONTATO),
    };
    expect(respostas.semOpcao.status).toBe(200);
    expect(textoVisivel(await respostas.semOpcao.text())).toContain("Cartão ainda não configurado");
    expect(respostas.inativo.status).toBe(410);
    expect(respostas.inexistente.status).toBe(404);
    expect(respostas.invalido.status).toBe(404);

    expect(await buscarCartaoPorCodigo(db, semOpcao)).toMatchObject({ status: "NAO_CONFIGURADO", destinoUrl: null });
    expect(await buscarCartaoPorCodigo(db, inativo)).toMatchObject({ status: "INATIVO", destinoUrl: null });
    const todos = await db.select().from(contatos);
    expect(todos.filter((contato) => [semOpcao, inativo].includes(contato.cartaoCodigo))).toEqual([]);
  });

  it("desligar a opção no lote fecha a ativação na hora", async () => {
    const { identificador, codigos } = await criarCartoes();
    await definirAtivacaoPeloCliente(db, identificador, false, []);
    expect(textoVisivel(await (await abrir(codigos[0])).text())).toContain("Cartão ainda não configurado");
    await enviar(codigos[0], CONTATO);
    expect((await buscarCartaoPorCodigo(db, codigos[0]))?.status).toBe("NAO_CONFIGURADO");
  });
});

describe("duas ativações ao mesmo tempo", () => {
  it("só a primeira vence; a segunda vê que o cartão acabou de ser ativado", async () => {
    const codigo = await umCartao();
    const [a, b] = await Promise.all([
      enviar(codigo, { ...CONTATO, loja: "Loja A", link: "@loja_a" }),
      enviar(codigo, { ...CONTATO, loja: "Loja B", link: "@loja_b" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const perdedora = a.status === 409 ? a : b;
    expect(textoVisivel(await perdedora.text())).toContain("Este cartão acabou de ser ativado.");

    const doCartao = await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo));
    expect(doCartao).toHaveLength(1);
    const cartao = await buscarCartaoPorCodigo(db, codigo);
    const vencedora = doCartao[0].loja === "Loja A" ? "loja_a" : "loja_b";
    // Contato e link gravados são da MESMA pessoa: nada fica misturado.
    expect(cartao?.destinoUrl).toBe(`https://www.instagram.com/${vencedora}/`);
  });

  it("o serviço recusa a segunda gravação mesmo com dados já validados", async () => {
    const codigo = await umCartao();
    const dados = validarAtivacao(CONTATO, "INSTAGRAM");
    if (!dados.ok) throw new Error("dados de teste inválidos");
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => ativarPeloCliente(db, codigo, dados.dados, VERSAO_DO_TEXTO_DE_PRIVACIDADE)),
    );
    expect(resultados.filter((r) => r.resultado === "ATIVADO")).toHaveLength(1);
    expect(resultados.filter((r) => r.resultado === "JA_ATIVADO")).toHaveLength(4);
    expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo))).toHaveLength(1);
  });

  it("um link de Google não ativa um cartão de Instagram, nem com dados montados à mão", async () => {
    const codigo = await umCartao({ tipo: "INSTAGRAM" });
    const doGoogle = validarAtivacao({ ...CONTATO, link: "https://g.page/r/abc/review" }, "GOOGLE");
    if (!doGoogle.ok) throw new Error("dados de teste inválidos");
    expect(await ativarPeloCliente(db, codigo, doGoogle.dados, VERSAO_DO_TEXTO_DE_PRIVACIDADE)).toEqual({
      resultado: "INDISPONIVEL",
    });
    expect((await buscarCartaoPorCodigo(db, codigo))?.status).toBe("NAO_CONFIGURADO");
  });
});

describe("robôs e limite de tentativas", () => {
  it("campo invisível preenchido: nada é gravado, mesmo com todos os dados certos", async () => {
    const codigo = await umCartao();
    const html = await (await abrir(codigo)).text();
    expect(html).toContain('name="empresa_site" tabindex="-1" autocomplete="off"');

    const resposta = await enviar(codigo, { ...CONTATO, empresa_site: "https://spam.example" });
    expect(resposta.status).toBe(400);
    expect(textoVisivel(await resposta.text())).not.toContain("Cartão ativado");
    const conferencia = await conferir(codigo, { ...CONTATO, empresa_site: "x" }, 3);
    expect(conferencia.status).toBe(400);

    expect(await buscarCartaoPorCodigo(db, codigo)).toMatchObject({ status: "NAO_CONFIGURADO", destinoUrl: null });
    expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo))).toEqual([]);
  });

  it("limite por cartão: depois de muitos envios, nem um envio correto passa", async () => {
    const codigo = await umCartao();
    const { maximo } = LIMITES_DA_ATIVACAO.envioPorCartao;
    for (let i = 0; i < maximo; i++) {
      // IPs diferentes: quem barra é o contador do cartão.
      expect((await enviar(codigo, { ...CONTATO, nome: "" })).status).toBe(422);
    }
    const bloqueado = await enviar(codigo, CONTATO);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get("Retry-After")).toBe("600");
    expect(textoVisivel(await bloqueado.text())).toContain("Muitas tentativas em pouco tempo.");
    expect((await buscarCartaoPorCodigo(db, codigo))?.status).toBe("NAO_CONFIGURADO");
  });

  it("limite por IP: vale para cartões diferentes, e não atrapalha outros IPs", async () => {
    const { codigos } = await criarCartoes({ quantidade: LIMITES_DA_ATIVACAO.envioPorIp.maximo + 2 });
    const ip = "203.0.113.77";
    for (let i = 0; i < LIMITES_DA_ATIVACAO.envioPorIp.maximo; i++) {
      expect((await enviar(codigos[i], { ...CONTATO, nome: "" }, { ip })).status).toBe(422);
    }
    const ultimo = codigos[codigos.length - 1];
    expect((await enviar(ultimo, CONTATO, { ip })).status).toBe(429);
    expect((await buscarCartaoPorCodigo(db, ultimo))?.status).toBe("NAO_CONFIGURADO");
    // Outra pessoa, de outro IP, ativa normalmente o mesmo cartão.
    expect((await enviar(ultimo, CONTATO, { ip: "203.0.113.78" })).status).toBe(200);
  });

  it("a conferência dos passos tem o seu próprio limite, em JSON", async () => {
    const codigo = await umCartao();
    const { maximo } = LIMITES_DA_ATIVACAO.conferenciaPorCartao;
    for (let i = 0; i < maximo; i++) await conferir(codigo, {}, 1);
    const bloqueada = await conferir(codigo, CONTATO, 3);
    expect(bloqueada.status).toBe(429);
    expect(await bloqueada.json()).toEqual({
      ok: false,
      mensagem: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
    });
    // O envio final conta à parte: quem só conferiu muitas vezes ainda consegue ativar.
    expect((await enviar(codigo, CONTATO)).status).toBe(200);
  });

  it("o contador fica no banco, não guarda o IP em claro e recomeça quando a janela termina", async () => {
    const codigo = await umCartao();
    await enviar(codigo, { ...CONTATO, nome: "" }, { ip: "203.0.113.200" });
    const linhas = await db.select().from(limitesDeTentativas);
    expect(linhas.some((linha) => linha.chave === `envio:cartao:${codigo}`)).toBe(true);
    expect(linhas.some((linha) => /^envio:ip:[0-9a-f]{24}$/.test(linha.chave))).toBe(true);
    expect(JSON.stringify(linhas)).not.toContain("203.0.113.200");

    const regra = { maximo: 2, janelaEmSegundos: 60 };
    const inicio = new Date("2026-10-06T12:00:00Z");
    const em = (segundos: number) => new Date(inicio.getTime() + segundos * 1000);
    expect(await registrarTentativa(db, "teste:janela", regra, em(0))).toEqual({ permitido: true, contagem: 1 });
    expect(await registrarTentativa(db, "teste:janela", regra, em(10))).toEqual({ permitido: true, contagem: 2 });
    expect(await registrarTentativa(db, "teste:janela", regra, em(59))).toEqual({ permitido: false, contagem: 3 });
    // Passada a janela, a contagem recomeça.
    expect(await registrarTentativa(db, "teste:janela", regra, em(60))).toEqual({ permitido: true, contagem: 1 });

    await limparLimitesVencidos(db, em(3600));
    const restantes = await db.select().from(limitesDeTentativas).where(eq(limitesDeTentativas.chave, "teste:janela"));
    expect(restantes).toEqual([]);
  });

  it("recusa envio vindo de outro site, com outro formato ou grande demais", async () => {
    const codigo = await umCartao();
    const deOutroSite = await enviar(codigo, CONTATO, { cabecalhos: { origin: "https://site-malicioso.example" } });
    expect(deOutroSite.status).toBe(403);
    const doProprioSite = await conferir(codigo, CONTATO, 3, { cabecalhos: { origin: BASE, host: "go.example.com" } });
    expect(doProprioSite.status).toBe(200);

    const emJson = await POST(
      new Request(`${BASE}/c/${codigo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(CONTATO) }),
      contexto(codigo),
    );
    expect(emJson.status).toBe(400);
    const enorme = await enviar(codigo, { ...CONTATO, loja: "x".repeat(20000) });
    expect(enorme.status).toBe(400);
    expect((await buscarCartaoPorCodigo(db, codigo))?.status).toBe("NAO_CONFIGURADO");
  });
});

describe("linguagem para o cliente", () => {
  it("nenhuma tela usa termos técnicos ou de vendas", async () => {
    const instagram = await umCartao({ tipo: "INSTAGRAM" });
    const google = await umCartao({ tipo: "GOOGLE" });
    const ativado = await umCartao();
    const telas = [
      await abrir(instagram),
      await abrir(google),
      await enviar(instagram, { ...CONTATO, link: "https://facebook.com/x", whatsapp: "123" }),
      await enviar(google, { ...CONTATO, link: "@padaria" }),
      await enviar(ativado, CONTATO),
      await enviar(ativado, CONTATO),
    ];
    for (const tela of telas) {
      const texto = textoVisivel(await tela.text());
      for (const proibida of ["lead", "URL", "redirecionamento", "destino", "CEO"]) {
        expect(texto, `"${proibida}" em uma tela do cliente`).not.toMatch(new RegExp(`\\b${proibida}\\b`, "i"));
      }
    }
  });
});

describe("opção do lote e ativação pelo painel", () => {
  it("lotes começam com a opção desligada", async () => {
    const { lote } = await criarLote(db, { quantidade: 1, tipo: "INSTAGRAM", descricao: null });
    expect(lote.ativacaoPeloCliente).toBe(false);
  });

  it("só liga em lote de Instagram ou Google, e com o atendimento configurado", async () => {
    const semTipo = await criarLote(db, { quantidade: 1, tipo: null, descricao: null });
    await expect(definirAtivacaoPeloCliente(db, semTipo.lote.identificador, true, [])).rejects.toThrow(
      "só existe para lotes de Instagram ou de Google",
    );
    const generico = await criarLote(db, { quantidade: 1, tipo: "GENERICO", descricao: null });
    await expect(definirAtivacaoPeloCliente(db, generico.lote.identificador, true, [])).rejects.toThrow();

    const instagram = await criarLote(db, { quantidade: 1, tipo: "INSTAGRAM", descricao: null });
    await expect(
      definirAtivacaoPeloCliente(db, instagram.lote.identificador, true, ["ATENDIMENTO_WHATSAPP (WhatsApp de atendimento, com DDD)"]),
    ).rejects.toThrow("Antes de liberar a ativação pelo cliente, configure na Vercel: ATENDIMENTO_WHATSAPP");
    expect((await definirAtivacaoPeloCliente(db, instagram.lote.identificador, true, [])).ativacaoPeloCliente).toBe(true);
    // Desligar é sempre permitido.
    expect((await definirAtivacaoPeloCliente(db, instagram.lote.identificador, false, ["qualquer"])).ativacaoPeloCliente).toBe(false);
    await expect(definirAtivacaoPeloCliente(db, "lote-1999-001", true, [])).rejects.toThrow("Lote não encontrado.");
  });

  it("a ativação pelo painel continua igual: sem contato, em qualquer lote", async () => {
    const liberado = await umCartao();
    const comum = await umCartao({ liberado: false });
    for (const codigo of [liberado, comum]) {
      const cartao = await configurarDestino(db, { codigo, tipo: "GOOGLE", destinoUrl: "https://g.page/r/abc/review" });
      expect(cartao).toMatchObject({ status: "ATIVO", tipo: "GOOGLE", destinoUrl: "https://g.page/r/abc/review" });
      expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigo))).toEqual([]);
    }
    // E o administrador pode trocar o link de um cartão que o cliente ativou.
    const doCliente = await umCartao();
    await enviar(doCliente, CONTATO);
    const trocado = await configurarDestino(db, { codigo: doCliente, tipo: "INSTAGRAM", destinoUrl: "https://instagram.com/novo" });
    expect(trocado.destinoUrl).toBe("https://instagram.com/novo");
    expect(await db.select().from(contatos).where(eq(contatos.cartaoCodigo, doCliente))).toHaveLength(1);
  });

  it("apagar o lote apaga os cartões, mas o contato continua (sem o cartão)", async () => {
    const { identificador, codigos } = await criarCartoes();
    await enviar(codigos[0], CONTATO);
    await excluirLote(db, identificador, identificador);
    const [contato] = await db.select().from(contatos).where(eq(contatos.cartaoCodigo, codigos[0]));
    expect(contato).toMatchObject({ cartaoId: null, loja: "Padaria do Zé", loteIdentificador: identificador });
    expect(await db.select().from(cartoes).where(eq(cartoes.codigo, codigos[0]))).toEqual([]);
  });
});
