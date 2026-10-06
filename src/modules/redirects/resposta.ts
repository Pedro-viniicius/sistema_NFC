// Converte a resolução em resposta HTTP. As páginas são HTML estático mínimo:
// nenhum dado do visitante ou do cartão é inserido nelas.
import type { Resolucao } from "./resolver";

const CABECALHOS_COMUNS = {
  // O destino pode mudar a qualquer momento: nada desta rota pode ficar em cache.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function pagina(status: number, titulo: string, mensagem: string, extras: HeadersInit = {}): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:22rem;margin:1.5rem;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:1rem;text-align:center}
h1{margin:0 0 .75rem;font-size:1.25rem}
p{margin:0;color:#475569;line-height:1.5}
</style>
</head>
<body>
<main>
<h1>${titulo}</h1>
<p>${mensagem}</p>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      ...CABECALHOS_COMUNS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      ...extras,
    },
  });
}

export function respostaDaResolucao(resolucao: Resolucao): Response {
  switch (resolucao.situacao) {
    case "REDIRECIONAR":
      // 302 (temporário) de propósito: um 301/308 seria guardado pelo navegador
      // e o cartão continuaria indo para o destino antigo depois de reconfigurado.
      return new Response(null, {
        status: 302,
        headers: { ...CABECALHOS_COMUNS, Location: resolucao.destino },
      });
    case "NAO_CONFIGURADO":
      return pagina(
        200,
        "Cartão ainda não configurado",
        "Este cartão está aguardando configuração. Tente novamente em breve.",
      );
    case "INATIVO":
      return pagina(410, "Cartão indisponível", "Este cartão está desativado no momento.");
    case "DESTINO_INVALIDO":
      return pagina(500, "Cartão indisponível", "Não foi possível abrir o destino deste cartão.");
    case "NAO_ENCONTRADO":
      return pagina(404, "Cartão não encontrado", "Verifique o endereço e tente novamente.");
  }
}

export function respostaDeFalhaTemporaria(): Response {
  return pagina(
    503,
    "Serviço temporariamente indisponível",
    "Tente novamente em alguns instantes.",
    { "Retry-After": "30" },
  );
}
