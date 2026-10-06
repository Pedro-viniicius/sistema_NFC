// Páginas públicas da ativação pelo cliente, servidas na própria URL permanente do cartão.
//
// São HTML puro, pequeno e sem dependências: abrem rápido em qualquer celular, mesmo com internet
// ruim. Um único <form> guarda todos os passos, então voltar nunca apaga o que já foi digitado; o
// script só mostra um passo por vez e pede ao servidor que confira cada um (as regras de validação
// existem em um lugar só, no servidor). Sem JavaScript, o formulário inteiro aparece de uma vez e
// continua funcionando.
//
// Todo valor que vem de fora passa por `esc` antes de entrar no HTML. Scripts e estilos só rodam
// com o `nonce` da resposta (Content-Security-Policy).
import { randomBytes } from "node:crypto";
import { PAPEIS, RAMOS, ROTULO_PAPEL, ROTULO_RAMO } from "@/modules/contacts/tipos";
import type { TipoComAtivacao } from "./link";
import type { CampoDaAtivacao, ErrosDaAtivacao } from "./validacao";
import { linkDoWhatsApp } from "./whatsapp";

const CABECALHOS_SEM_CACHE = {
  // Depende do estado do cartão: nunca pode ficar em cache, nem na CDN nem no navegador.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/** Nome do campo-isca: invisível para pessoas, tentador para robôs que preenchem tudo. */
export const CAMPO_ISCA = "empresa_site";

export function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ESTILO = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f1f5f9;color:#0f172a;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:18px;line-height:1.45}
main{max-width:30rem;margin:0 auto;padding:1.25rem 1.1rem 3rem}
.cartao{background:#fff;border:1px solid #e2e8f0;border-radius:1.1rem;padding:1.4rem 1.2rem}
h1{margin:0 0 .5rem;font-size:1.55rem;line-height:1.2}
h2{margin:0 0 1rem;font-size:1.35rem;line-height:1.25}
h1:focus,h2:focus{outline:none}
p{margin:0 0 1rem}
.suave{color:#475569}
.pequeno{font-size:.95rem}
label,legend{display:block;font-weight:600;margin:0 0 .4rem;padding:0}
fieldset{border:0;margin:0;padding:0}
.campo{margin:0 0 1.25rem}
input[type=text],input[type=tel],select{display:block;width:100%;min-height:3.4rem;padding:.75rem .9rem;font:inherit;font-size:1.15rem;color:inherit;background:#fff;border:2px solid #94a3b8;border-radius:.8rem}
input:focus,select:focus{outline:3px solid #bfdbfe;border-color:#1d4ed8}
[aria-invalid=true]{border-color:#b91c1c}
.dica{margin:.4rem 0 0;color:#475569;font-size:.95rem;font-weight:400}
.erro{margin:.45rem 0 0;color:#b91c1c;font-weight:600;font-size:1rem}
.opcao{display:flex;align-items:center;gap:.75rem;min-height:3.4rem;padding:.6rem .9rem;margin:0 0 .5rem;border:2px solid #cbd5e1;border-radius:.8rem;font-weight:500;cursor:pointer}
.opcao input{width:1.4rem;height:1.4rem;flex:none;accent-color:#0f172a}
.aceite{display:flex;align-items:flex-start;gap:.75rem;font-weight:400;cursor:pointer}
.aceite input{width:1.5rem;height:1.5rem;flex:none;margin-top:.15rem;accent-color:#0f172a}
.botao{display:block;width:100%;min-height:3.6rem;padding:.9rem 1rem;font:inherit;font-size:1.15rem;font-weight:700;text-align:center;text-decoration:none;color:#fff;background:#0f172a;border:2px solid #0f172a;border-radius:.9rem;cursor:pointer}
.botao:disabled{opacity:.6}
.botao.claro{color:#0f172a;background:#fff;border-color:#94a3b8;font-weight:600}
.botoes{display:grid;gap:.7rem;margin-top:1.5rem}
.progresso{margin:0 0 1rem;font-weight:600;color:#334155}
.trilho{height:.5rem;margin-top:.45rem;background:#cbd5e1;border-radius:1rem;overflow:hidden}
.fio{display:block;height:100%;width:25%;background:#0f172a;border-radius:1rem;transition:width .2s}
.destaque{margin:0 0 1rem;padding:1rem;background:#f1f5f9;border-radius:.8rem;font-size:1.2rem;font-weight:700;word-break:break-word}
.aviso{margin:0 0 1rem;padding:.9rem 1rem;background:#fef2f2;border:1px solid #fecaca;border-radius:.8rem;color:#991b1b;font-weight:600}
.ok{font-size:3rem;line-height:1;margin:0 0 .5rem}
ol{margin:.5rem 0 0;padding-left:1.3rem}
li{margin:0 0 .4rem}
details{margin:.8rem 0 0;padding:.8rem 1rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.8rem}
summary{font-weight:600;cursor:pointer}
a{color:#1d4ed8}
.isca{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
.com-js section[data-passo]{display:none}
.com-js section[data-passo].atual{display:block}
.sem-js .so-js{display:none}
.sem-js section[data-passo]{margin:0 0 2rem}
[hidden]{display:none!important}
`;

/** Script da página de ativação. É um texto fixo: nenhum dado da requisição entra nele. */
const SCRIPT = `
(function(){
  var form=document.getElementById('ativacao');
  if(!form)return;
  var chave='ativacao:'+form.getAttribute('data-codigo');
  var secoes=[].slice.call(form.querySelectorAll('section[data-passo]'));
  var progresso=document.getElementById('progresso');
  var numero=document.getElementById('passo-atual');
  var fio=document.getElementById('fio');
  var aviso=document.getElementById('aviso');
  var exibicao=document.getElementById('link-exibido');
  var atual=0;

  function cada(seletor,fn){[].forEach.call(form.querySelectorAll(seletor),fn);}
  function guardar(){
    try{
      var v={};
      cada('input[name],select[name]',function(c){
        if(c.name==='${CAMPO_ISCA}')return;
        if(c.type==='radio'){if(c.checked)v[c.name]=c.value;}
        else if(c.type==='checkbox'){v[c.name]=c.checked;}
        else v[c.name]=c.value;
      });
      sessionStorage.setItem(chave,JSON.stringify({passo:Math.min(atual,3),v:v}));
    }catch(e){}
  }
  function recuperar(){
    try{
      var d=JSON.parse(sessionStorage.getItem(chave)||'null');
      if(!d||!d.v)return 0;
      cada('input[name],select[name]',function(c){
        if(!(c.name in d.v))return;
        if(c.type==='radio')c.checked=(c.value===d.v[c.name]);
        else if(c.type==='checkbox')c.checked=!!d.v[c.name];
        else c.value=d.v[c.name];
      });
      return d.passo||0;
    }catch(e){return 0;}
  }
  function avisar(texto){aviso.textContent=texto||'';aviso.hidden=!texto;if(texto)aviso.scrollIntoView();}
  function limparErros(){
    cada('.erro',function(e){e.textContent='';e.hidden=true;});
    cada('[aria-invalid]',function(c){c.removeAttribute('aria-invalid');});
    avisar('');
  }
  function mostrarErros(erros){
    var primeiro=null;
    Object.keys(erros).forEach(function(campo){
      var e=document.getElementById('erro-'+campo);
      if(e){e.textContent=erros[campo];e.hidden=false;}
      cada('[name="'+campo+'"]',function(c){c.setAttribute('aria-invalid','true');if(!primeiro)primeiro=c;});
    });
    if(primeiro){primeiro.focus();}
  }
  function decisor(){
    var marcado=form.querySelector('input[name=papel]:checked');
    document.getElementById('campo-decisor').hidden=!marcado||marcado.value==='DONO';
  }
  function mostrar(n,historico){
    atual=n;
    secoes.forEach(function(s){s.className=(+s.getAttribute('data-passo')===n)?'atual':'';});
    progresso.hidden=n<1;
    numero.textContent=String(n);
    fio.style.width=(n*25)+'%';
    if(historico==='novo')history.pushState({passo:n},'');
    else if(historico==='trocar')history.replaceState({passo:n},'');
    var titulo=secoes[n]&&secoes[n].querySelector('h1,h2');
    if(titulo){titulo.setAttribute('tabindex','-1');titulo.focus();}
    window.scrollTo(0,0);
    guardar();
  }
  function conferir(n,botao){
    limparErros();
    var corpo=new URLSearchParams(new FormData(form));
    corpo.set('acao','conferir');
    corpo.set('ate',String(n));
    botao.disabled=true;
    fetch(form.getAttribute('action'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:corpo.toString()})
      .then(function(r){return r.json();})
      .then(function(j){
        botao.disabled=false;
        if(j.ok){if(n===3&&j.link)exibicao.textContent=j.link;mostrar(n+1,'novo');}
        else if(j.recarregar){location.reload();}
        else if(j.erros){mostrarErros(j.erros);}
        else avisar(j.mensagem||'Não deu certo agora. Tente de novo.');
      })
      .catch(function(){botao.disabled=false;avisar('Sem internet no momento. Confira a conexão e toque de novo.');});
  }
  function avancar(botao){if(atual===0)mostrar(1,'novo');else if(atual<4)conferir(atual,botao);}

  cada('[data-avancar]',function(b){b.addEventListener('click',function(){avancar(b);});});
  cada('[data-voltar]',function(b){b.addEventListener('click',function(){limparErros();history.back();});});
  window.addEventListener('popstate',function(e){
    limparErros();
    mostrar(e.state&&typeof e.state.passo==='number'?e.state.passo:0,'');
  });
  cada('input[name=papel]',function(c){c.addEventListener('change',decisor);});
  var zap=form.querySelector('input[name=whatsapp]');
  zap.addEventListener('input',function(){
    var d=zap.value.replace(/\\D/g,'');
    if(d.length>11&&d.slice(0,2)==='55')d=d.slice(2);
    d=d.slice(0,11);
    var t=d;
    if(d.length>2)t='('+d.slice(0,2)+') '+d.slice(2);
    if(d.length>6){var m=d.length===11?7:6;t='('+d.slice(0,2)+') '+d.slice(2,m)+'-'+d.slice(m);}
    zap.value=t;
  });
  function aoMexer(e){
    var campo=e.target&&e.target.name;
    if(campo){
      var erro=document.getElementById('erro-'+campo);
      if(erro){erro.textContent='';erro.hidden=true;}
      cada('[name="'+campo+'"]',function(c){c.removeAttribute('aria-invalid');});
    }
    guardar();
  }
  form.addEventListener('input',aoMexer);
  form.addEventListener('change',aoMexer);
  form.addEventListener('submit',function(e){
    if(atual!==4){e.preventDefault();avancar(secoes[atual].querySelector('[data-avancar]'));return;}
    var b=document.getElementById('ativar');
    b.disabled=true;b.textContent='Ativando…';
  });

  var inicial=+form.getAttribute('data-passo-inicial')||0;
  if(!form.hasAttribute('data-do-servidor'))inicial=recuperar();
  decisor();
  mostrar(inicial,'trocar');
  if(form.hasAttribute('data-do-servidor')){
    var comErro=form.querySelector('.erro:not([hidden])');
    if(comErro)comErro.scrollIntoView();
  }
})();
`;

function documento(titulo: string, corpo: string, nonce: string, status: number, script = ""): Response {
  const html = `<!doctype html>
<html lang="pt-BR" class="sem-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="format-detection" content="telephone=no">
<title>${esc(titulo)}</title>
<script nonce="${nonce}">document.documentElement.className='com-js';</script>
<style nonce="${nonce}">${ESTILO}</style>
</head>
<body>
<main>
${corpo}
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      ...CABECALHOS_SEM_CACHE,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; ` +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function novoNonce(): string {
  return randomBytes(16).toString("base64");
}

const TEXTOS = {
  INSTAGRAM: {
    nome: "Instagram",
    boasVindas:
      "Este é um cartão de <strong>Instagram</strong>. Quando alguém aproximar o celular dele ou ler o código, vai abrir o perfil da sua loja.",
    precisa: "Você só vai precisar do <strong>@ da loja</strong> no Instagram.",
    rotulo: "Instagram da sua loja",
    exemplo: "@minhaloja",
    dica: "Pode ser o @ ou o link do perfil.",
    ajuda: "",
  },
  GOOGLE: {
    nome: "Google",
    boasVindas:
      "Este é um cartão de <strong>avaliações no Google</strong>. Quando alguém aproximar o celular dele ou ler o código, vai abrir a página para avaliar a sua empresa.",
    precisa: "Você vai precisar do <strong>link da sua empresa no Google</strong>. A gente mostra como achar.",
    rotulo: "Link da sua empresa no Google",
    exemplo: "Cole o link aqui",
    dica: "Toque no campo, segure e escolha “Colar”.",
    ajuda: `<details>
<summary>Como achar o link pelo celular</summary>
<ol>
<li>Abra o <strong>Google Maps</strong> e procure o nome da sua empresa.</li>
<li>Toque na empresa e depois em <strong>Compartilhar</strong>.</li>
<li>Toque em <strong>Copiar link</strong>, volte aqui e cole.</li>
</ol>
<p class="dica">Se você cuida do perfil da empresa no Google, também serve o link de “Pedir avaliações”.</p>
</details>`,
  },
} as const;

export interface DadosDaPaginaDeAtivacao {
  codigo: string;
  tipo: TipoComAtivacao;
  /** Valores já enviados (quando o servidor devolve o formulário com erros). */
  valores?: Record<string, string>;
  erros?: ErrosDaAtivacao;
  /** Passo a mostrar ao abrir. */
  passoInicial?: 0 | 1 | 2 | 3;
  /** Aviso geral, fora de um campo. */
  aviso?: string;
}

function erroDoCampo(campo: CampoDaAtivacao, erros: ErrosDaAtivacao): string {
  const mensagem = erros[campo];
  return `<p class="erro" id="erro-${campo}" role="alert"${mensagem ? "" : " hidden"}>${esc(mensagem ?? "")}</p>`;
}

function invalido(campo: CampoDaAtivacao, erros: ErrosDaAtivacao): string {
  return erros[campo] ? ' aria-invalid="true"' : "";
}

/** Página com o passo a passo da ativação. Abrir esta página nunca altera nada no cartão. */
export function paginaDeAtivacao(dados: DadosDaPaginaDeAtivacao, status = 200): Response {
  const { codigo, tipo } = dados;
  const valores = dados.valores ?? {};
  const erros = dados.erros ?? {};
  const texto = TEXTOS[tipo];
  const v = (campo: string) => esc(valores[campo] ?? "");
  const doServidor = dados.valores ? " data-do-servidor" : "";

  const ramos = RAMOS.map(
    (ramo) => `<option value="${ramo}"${valores.ramo === ramo ? " selected" : ""}>${esc(ROTULO_RAMO[ramo])}</option>`,
  ).join("");
  const papeis = PAPEIS.map(
    (papel) =>
      `<label class="opcao"><input type="radio" name="papel" value="${papel}"${valores.papel === papel ? " checked" : ""}> ${esc(ROTULO_PAPEL[papel])}</label>`,
  ).join("");

  const corpo = `
<div class="progresso" id="progresso" hidden>Passo <span id="passo-atual">1</span> de 4
<div class="trilho"><span class="fio" id="fio"></span></div></div>
<form id="ativacao" class="cartao" method="post" action="/c/${esc(codigo)}" novalidate autocomplete="on"
 data-codigo="${esc(codigo)}" data-passo-inicial="${dados.passoInicial ?? 0}"${doServidor}>
<p class="aviso" id="aviso" role="alert"${dados.aviso ? "" : " hidden"}>${esc(dados.aviso ?? "")}</p>
<div class="isca" aria-hidden="true"><label>Deixe este campo em branco
<input type="text" name="${CAMPO_ISCA}" tabindex="-1" autocomplete="off" value=""></label></div>

<section data-passo="0">
<h1>Vamos ativar o seu cartão</h1>
<p class="suave">Leva menos de 1 minuto.</p>
<p>${texto.boasVindas}</p>
<p>${texto.precisa}</p>
<div class="botoes so-js"><button type="button" class="botao" data-avancar>Começar</button></div>
</section>

<section data-passo="1">
<h2>Sua loja</h2>
<div class="campo">
<label for="loja">Nome da sua loja ou empresa</label>
<input type="text" id="loja" name="loja" maxlength="80" autocomplete="organization" autocapitalize="words" value="${v("loja")}"${invalido("loja", erros)}>
${erroDoCampo("loja", erros)}
</div>
<div class="campo">
<label for="ramo">Ramo do negócio <span class="suave">(opcional)</span></label>
<select id="ramo" name="ramo"${invalido("ramo", erros)}><option value="">Escolha…</option>${ramos}</select>
${erroDoCampo("ramo", erros)}
</div>
<div class="botoes so-js"><button type="button" class="botao" data-avancar>Continuar</button>
<button type="button" class="botao claro" data-voltar>Voltar</button></div>
</section>

<section data-passo="2">
<h2>Contato</h2>
<div class="campo">
<label for="nome">Seu nome</label>
<input type="text" id="nome" name="nome" maxlength="80" autocomplete="name" autocapitalize="words" value="${v("nome")}"${invalido("nome", erros)}>
${erroDoCampo("nome", erros)}
</div>
<fieldset class="campo">
<legend>Quem cuida do negócio?</legend>
${papeis}
${erroDoCampo("papel", erros)}
</fieldset>
<div class="campo" id="campo-decisor">
<label for="decisor">Nome de quem decide as coisas na loja</label>
<input type="text" id="decisor" name="decisor" maxlength="80" autocapitalize="words" value="${v("decisor")}"${invalido("decisor", erros)}>
${erroDoCampo("decisor", erros)}
</div>
<div class="campo">
<label for="whatsapp">WhatsApp para contato</label>
<input type="tel" id="whatsapp" name="whatsapp" inputmode="numeric" autocomplete="tel-national" maxlength="20" placeholder="(11) 91234-5678" value="${v("whatsapp")}"${invalido("whatsapp", erros)}>
<p class="dica">É por ele que ajudamos você com o cartão.</p>
${erroDoCampo("whatsapp", erros)}
</div>
<div class="campo">
<label class="aceite"><input type="checkbox" name="ofertas" value="sim"${valores.ofertas === "sim" ? " checked" : ""}>
<span>Aceito receber mensagens no WhatsApp sobre novidades e outros produtos</span></label>
<p class="dica"><a href="/privacidade" target="_blank" rel="noopener">Como usamos seus dados</a></p>
</div>
<div class="botoes so-js"><button type="button" class="botao" data-avancar>Continuar</button>
<button type="button" class="botao claro" data-voltar>Voltar</button></div>
</section>

<section data-passo="3">
<h2>Link do cartão</h2>
<div class="campo">
<label for="link">${texto.rotulo}</label>
<input type="text" id="link" name="link" maxlength="2048" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="${esc(texto.exemplo)}" value="${v("link")}"${invalido("link", erros)}>
<p class="dica">${esc(texto.dica)}</p>
${erroDoCampo("link", erros)}
${texto.ajuda}
</div>
<div class="botoes so-js"><button type="button" class="botao" data-avancar>Continuar</button>
<button type="button" class="botao claro" data-voltar>Voltar</button></div>
</section>

<section data-passo="4">
<h2>Confirmar</h2>
<div class="so-js"><p>Seu cartão vai abrir:</p>
<p class="destaque" id="link-exibido"></p></div>
<p class="suave">Depois de ativar, para trocar o link é só falar com a gente.</p>
<div class="botoes"><button type="submit" class="botao" id="ativar">Está certo, ativar</button>
<button type="button" class="botao claro so-js" data-voltar>Corrigir</button></div>
</section>
</form>`;

  return documento(`Ativar cartão de ${texto.nome}`, corpo, novoNonce(), status, SCRIPT);
}

export interface DadosDoCartaoAtivado {
  codigo: string;
  /** WhatsApp de atendimento do administrador (+55…). */
  whatsappDeAtendimento: string | null;
  /** Presente logo depois da ativação: o link que o cartão vai abrir. */
  linkExibido?: string;
  /**
   * "agora": esta requisição ativou o cartão.
   * "outro": o cartão foi ativado por outro envio, instantes antes (ou já estava ativado).
   */
  quando: "agora" | "outro";
}

/** Tela final. Só mostra informação: nenhum envio a partir dela altera o cartão. */
export function paginaDeCartaoAtivado(dados: DadosDoCartaoAtivado, status = 200): Response {
  const { codigo } = dados;
  const conversa = dados.whatsappDeAtendimento
    ? linkDoWhatsApp(dados.whatsappDeAtendimento, `Olá! Preciso trocar o link do meu cartão ${codigo}.`)
    : null;
  const titulo = dados.quando === "agora" ? "Cartão ativado!" : "Este cartão acabou de ser ativado.";
  const corpo = `
<div class="cartao">
<p class="ok" aria-hidden="true">${dados.quando === "agora" ? "✅" : "ℹ️"}</p>
<h1>${titulo}</h1>
${
  dados.linkExibido
    ? `<p>Ele já está funcionando e abre:</p><p class="destaque">${esc(dados.linkExibido)}</p>`
    : `<p class="suave">Ele já está funcionando. Se não foi você quem ativou, fale com a gente.</p>`
}
<div class="botoes">
<a class="botao" href="/c/${esc(codigo)}">Testar agora</a>
${conversa ? `<a class="botao claro" href="${esc(conversa)}" rel="noopener">Precisa trocar o link? Fale com a gente</a>` : ""}
</div>
</div>`;
  const limpar = `try{sessionStorage.removeItem('ativacao:${codigo.replace(/[^A-Z0-9]/g, "")}');}catch(e){}`;
  return documento(titulo, corpo, novoNonce(), status, limpar);
}

/** Aviso simples (limite de tentativas, envio recusado). */
export function paginaDeAviso(titulo: string, mensagem: string, status: number, extras: HeadersInit = {}): Response {
  const resposta = documento(
    titulo,
    `<div class="cartao"><h1>${esc(titulo)}</h1><p class="suave">${esc(mensagem)}</p></div>`,
    novoNonce(),
    status,
  );
  for (const [nome, valor] of Object.entries(extras)) resposta.headers.set(nome, valor);
  return resposta;
}

/** Resposta da conferência de um passo (chamada pelo script da página). */
export function respostaEmJson(corpo: Record<string, unknown>, status = 200, extras: HeadersInit = {}): Response {
  return Response.json(corpo, { status, headers: { ...CABECALHOS_SEM_CACHE, ...extras } });
}
