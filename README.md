# Cartões NFC e QR Codes configuráveis

Sistema para vender cartões/adesivos NFC com QR Code cujo destino pode ser trocado a qualquer momento,
**sem reimprimir o QR e sem regravar o chip**.

```
CARTÃO FÍSICO ──► URL PERMANENTE ──► BANCO ──► DESTINO ATUAL ──► REDIRECIONAMENTO
 (QR + NFC)       go.dominio.com/c/K8M4T2       instagram.com/empresa
```

## A regra mais importante

> O QR Code e o chip NFC de um cartão contêm **sempre a mesma URL permanente**
> (`https://go.meudominio.com/c/CODIGO`). O destino final (Instagram, Google etc.) fica **só no banco**.

Trocar o destino **não muda** o código, a URL permanente, o conteúdo do QR nem a URL do NFC.
Isso é garantido em três níveis:

1. **Código:** `getCardPublicUrl(codigo)` (`src/modules/cards/url-publica.ts`) é o único lugar que monta a URL;
   o gerador de QR (`src/modules/qr/gerar.ts`) só aceita o código do cartão, nunca uma URL de destino.
2. **Banco:** um trigger impede qualquer `UPDATE` no código de um cartão existente.
3. **Testes:** `tests/cenario-final.test.ts` executa o cenário completo e lê o QR gerado para conferir o conteúdo.

## Tecnologias

Next.js 16 (App Router) · TypeScript estrito · PostgreSQL (Neon) · Drizzle ORM · Zod · Tailwind CSS 4 ·
Vitest · pnpm · Vercel.

## Rodando localmente

Pré-requisitos: Node.js 22+, pnpm e Docker (para o PostgreSQL local).

```bash
pnpm install
cp .env.example .env.local        # ajuste AUTH_SECRET e, em desenvolvimento, NEXT_PUBLIC_APP_URL=http://localhost:3000
pnpm db:up                        # sobe o PostgreSQL local (porta 54329)
pnpm db:migrate                   # aplica as migrações
pnpm admin:criar voce@empresa.com.br   # cria o administrador (pede a senha, mínimo 12 caracteres)
pnpm dev                          # http://localhost:3000/admin
```

### Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Ambiente de desenvolvimento |
| `pnpm build` / `pnpm start` | Build e servidor de produção |
| `pnpm test` | Testes automatizados (Vitest; usa PostgreSQL em memória, não precisa de Docker) |
| `pnpm typecheck` | Checagem de tipos (TypeScript) |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Gera uma migração a partir de mudanças em `src/db/schema.ts` |
| `pnpm db:migrate` | Aplica as migrações pendentes no banco de `DATABASE_URL` |
| `pnpm db:up` | Sobe o PostgreSQL local via Docker |
| `pnpm admin:criar <email>` | Cria um administrador ou redefine a senha de um existente |

Nunca altere a estrutura do banco de produção manualmente: mude o schema, rode `pnpm db:generate`,
revise o SQL em `drizzle/` e aplique com `pnpm db:migrate`.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Conexão PostgreSQL. No Neon, use a URL com *pooler* e `sslmode=require`. |
| `AUTH_SECRET` | Segredo que assina a sessão do painel. Mínimo 32 caracteres (`openssl rand -base64 48`). |
| `NEXT_PUBLIC_APP_URL` | Domínio canônico dos cartões, ex.: `https://go.meudominio.com`. **É o que vai impresso no QR e gravado no NFC.** |

`NEXT_PUBLIC_APP_URL` é fixada no momento do build: se mudar, faça um novo deploy. Em produção o sistema
recusa `http://` e `localhost`, e o painel mostra um aviso se a URL for um endereço `.vercel.app`.
**Defina o domínio definitivo antes de imprimir o primeiro cartão** — cartão impresso com a URL errada não tem conserto.

## Deploy na Vercel

1. **Repositório:** envie o projeto para o GitHub e importe-o na Vercel (o framework Next.js é detectado sozinho).
2. **Banco:** no projeto da Vercel, abra *Storage* → *Create Database* → **Neon** (Marketplace). A integração cria
   `DATABASE_URL` (com pooler) automaticamente. Se já tiver um banco Neon, cadastre `DATABASE_URL` manualmente.
3. **Variáveis:** em *Settings → Environment Variables*, cadastre `AUTH_SECRET` e `NEXT_PUBLIC_APP_URL`
   (o domínio definitivo, para todos os ambientes — assim nenhum QR sai com URL de preview).
4. **Domínio:** em *Settings → Domains*, adicione `go.meudominio.com` e crie o CNAME indicado no seu DNS.
5. **Região:** em *Settings → Functions*, escolha a região mais próxima do banco (ex.: `gru1` com Neon em São Paulo).
   Isso é o que mais influencia a velocidade do redirecionamento.
6. **Migrações:** aplique no banco de produção a partir da sua máquina:
   ```bash
   DATABASE_URL="<url de produção>" pnpm db:migrate
   ```
   (Alternativa: usar `pnpm db:migrate && pnpm build` como *Build Command*. Só faça isso se os deploys de preview
   usarem outro banco, ex.: um *branch* do Neon.)
7. **Administrador:**
   ```bash
   DATABASE_URL="<url de produção>" pnpm admin:criar voce@empresa.com.br
   ```
8. **Deploy** e teste: gere um lote de 1 cartão, configure-o e acesse a URL permanente pelo celular.
9. **Recomendado:** em *Firewall*, crie uma regra de *rate limit* para `/c/*` e para `/login`
   (por exemplo, 60 requisições por minuto por IP). O sistema não faz rate limit por conta própria.

Nada é gravado em disco: QR Codes, CSV e ZIP são gerados sob demanda e tudo que precisa persistir fica no banco.

## Como usar

### Criar um lote de cartões
*Painel → Novo lote* → informe a quantidade (até 1.000), o tipo (Instagram, Google, Outro link ou sem tipo) → **Gerar lote**.
Cada cartão recebe um código único (ex.: `K8M4T2`) e nasce com status **Não configurado**.

### Exportar os QR Codes para a gráfica
Na página do lote, **Baixar QR Codes (ZIP)**:

```
lote-2026-001/
  K8M4T2.svg
  7PN3RX.svg
  ...
  lote.csv        ← codigo,url,tipo,arquivo_qr
```

Para um cartão avulso: página do cartão → **Baixar QR Code (SVG)** (`qr-K8M4T2.svg`) ou PNG.
Os QR Codes são pretos sobre branco, sem logotipo, com zona de silêncio de 4 módulos e correção de erro M.

### Obter a URL para gravar no NFC
Página do cartão → bloco **URL permanente** → **Copiar URL permanente**. É a mesma URL da coluna `url` do `lote.csv`.
Grave exatamente essa URL no chip (registro NDEF do tipo URL), com um app como o *NFC Tools*.
**Nunca grave o link do Instagram ou do Google direto no chip.**

### Configurar um cartão no momento da venda
*Ativar cartão* (botão sempre visível no topo):

1. digite o código do cartão (ou cole a URL lida do QR);
2. escolha **Instagram**, **Google** ou **Outro link**;
3. cole o link de destino (para Instagram também vale `@usuario`);
4. **Salvar**.

A tela confirma código, destino, status e URL permanente e oferece **Configurar próximo cartão**.
Ao colar um link sem ter escolhido o tipo, o sistema sugere o tipo sozinho.

### Trocar o destino depois
Página do cartão → **Alterar destino**, ou *Ativar cartão* com o mesmo código. O cartão físico continua igual.

## Arquitetura

Monólito modular. As regras de negócio ficam em `src/modules` e não dependem do Next.js;
`src/app` contém apenas rotas, telas e Server Actions.

```
src/
  app/
    c/[codigo]/route.ts        rota pública de redirecionamento (Route Handler, sem React)
    login/                     login do painel
    admin/                     painel, cartões, ativação rápida, lotes, downloads
    admin/acoes.ts             Server Actions (autenticação + validação Zod + chamada aos módulos)
  modules/
    cards/                     código, URL canônica, validação de destino, status, consultas e mutações
    redirects/                 decisão de redirecionamento e respostas HTTP
    qr/                        geração de QR Code (SVG/PNG)
    batches/                   lotes e exportação CSV/ZIP
    auth/                      senha (scrypt), token de sessão, login com bloqueio
  db/                          schema Drizzle e cliente PostgreSQL
  proxy.ts                     bloqueia /admin sem sessão (o "middleware" do Next 16)
drizzle/                       migrações SQL
tests/                         utilitários de teste e cenário final
```

### Modelo de dados

**`cartoes`** — um registro por cartão físico.

| Coluna | Descrição |
|---|---|
| `id` | UUID interno |
| `codigo` | Código público permanente (6 caracteres, único, imutável por trigger) |
| `tipo` | `INSTAGRAM`, `GOOGLE`, `GENERICO` ou nulo |
| `destino_url` | Destino atual do redirecionamento |
| `status` | `NAO_CONFIGURADO`, `ATIVO` ou `INATIVO` |
| `descricao` | Anotação interna |
| `lote_id` | Lote de origem |
| `total_acessos`, `ultimo_acesso_em` | Estatística simples de uso |
| `criado_em`, `atualizado_em`, `ativado_em` | Datas |

**`lotes`** — `identificador` (`lote-2026-001`), `ano`, `sequencia`, `quantidade`, `tipo`, `descricao`.
**`administradores`** — `email`, `senha_hash`, `tentativas_falhas`, `bloqueado_ate`.

Status e tipo usam `text` + `CHECK` em vez de ENUM. O banco também garante que um cartão **Ativo** sempre tem destino.

O código usa 31 caracteres (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, sem `0/O` e `1/I/L`), sorteados com gerador
criptográfico: cerca de 887 milhões de combinações, sem sequência previsível.

### Rotas

| Rota | Acesso | Função |
|---|---|---|
| `GET /c/[codigo]` | Público | Redireciona (302) para o destino atual |
| `/login` | Público | Entrada do painel |
| `/admin` | Admin | Indicadores e atalhos |
| `/admin/cartoes` | Admin | Listagem, busca e filtros |
| `/admin/cartoes/[codigo]` | Admin | Detalhe, URL do NFC, QR, destino, ativar/desativar |
| `/admin/cartoes/[codigo]/qr?formato=svg\|png` | Admin | QR Code |
| `/admin/ativar` | Admin | Ativação rápida |
| `/admin/lotes`, `/admin/lotes/novo`, `/admin/lotes/[identificador]` | Admin | Lotes |
| `/admin/lotes/[identificador]/exportar?formato=zip\|csv` | Admin | Exportação para a gráfica |

### Comportamento de `/c/[codigo]`

| Situação | Resposta |
|---|---|
| Cartão ativo com destino válido | `302` para o destino, `Cache-Control: no-store` |
| Cartão não configurado | `200` com página "Cartão ainda não configurado" |
| Cartão inativo | `410` com página "Cartão indisponível" |
| Código inexistente ou inválido | `404` |
| Destino salvo inválido | `500`, sem redirecionar (e registra log de erro) |
| Falha de banco | `503` |

O redirecionamento é `302` de propósito: um `301/308` ficaria guardado no celular do visitante
e o cartão continuaria indo para o destino antigo.

## Segurança

- **Painel fechado:** `proxy.ts` barra `/admin` sem sessão; além disso cada página, Server Action e rota de download
  confere a sessão de novo e verifica no banco se o administrador ainda existe.
- **Sessão:** JWT assinado (HS256) em cookie `HttpOnly`, `Secure` (produção) e `SameSite=Lax`, válido por 7 dias.
- **Senhas:** hash `scrypt` com sal aleatório; 5 erros seguidos bloqueiam a conta por 15 minutos;
  a resposta é a mesma para e-mail inexistente e senha errada.
- **CSRF:** toda alteração é feita por Server Action (POST com verificação de origem do Next.js) e o cookie é `SameSite`.
  Nenhuma rota GET altera dados.
- **Redirecionamento aberto:** o destino vem **somente do banco**; parâmetros como `?redirect=` são ignorados.
  Só administradores autenticados gravam destinos.
- **Validação de destino** (`src/modules/cards/destino.ts`), aplicada ao salvar e de novo ao redirecionar:
  apenas `https://` (e `http://` só em desenvolvimento); rejeita `javascript:`, `data:`, `file:` e outros esquemas,
  credenciais na URL, IPs, `localhost` e links para o próprio sistema; tipos Instagram e Google exigem o domínio correspondente.
- **Entradas:** validadas no servidor com Zod; a validação do navegador é só pré-visualização.
- **Cabeçalhos:** `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS; páginas públicas com CSP restrita.
- **Segredos:** apenas em variáveis de ambiente; `.env*` fica fora do Git (exceto `.env.example`).
- **Logs:** eventos operacionais em JSON (cartão não encontrado, destino inválido, erro de banco, login recusado),
  sem senhas, tokens ou e-mails.

## Estatísticas de acesso

Por cartão: **total de acessos** e **data do último acesso**. Nenhum IP, localização ou identificador do visitante
é armazenado. QR e NFC usam a mesma URL, então **não é possível saber por qual dos dois o acesso veio** —
o sistema não finge que sabe. A contagem é feita depois da resposta, para não atrasar o redirecionamento.

## Testes

`pnpm test` roda 138 testes contra um PostgreSQL em memória (PGlite) com as migrações reais:

- geração e validação de código (formato, alfabeto, unicidade, rejeição de inválidos);
- URL canônica e configuração de domínio;
- validação de destino (Instagram, Google, genérico; `javascript:`, `data:`, `file:` etc.);
- criação, configuração, ativação e desativação de cartões; código duplicado e código imutável no banco;
- todos os estados de `/c/[codigo]` e a contagem de acessos;
- QR Code (o teste lê o QR gerado e confere o conteúdo);
- lotes, CSV e ZIP;
- senha, sessão, bloqueio de login e proteção do painel;
- cenário final: destino muda, cartão físico não.

## Limitações e próximos passos

- **Gravação de NFC:** não é feita pelo sistema (o suporte dos navegadores é restrito ao Chrome no Android).
  Use um app gravador com a URL permanente. Dá para adicionar Web NFC depois.
- **Leitura por câmera:** não há; o campo de código aceita digitação, colagem e leitores de QR/código de barras
  que "digitam" a URL.
- **Acessos:** incluem robôs e pré-visualizações de link de aplicativos de mensagem.
- **Rate limit:** depende de regra no Firewall da Vercel. O bloqueio de login protege contra adivinhação de senha,
  mas alguém que saiba o e-mail do administrador pode mantê-lo bloqueado tentando senhas erradas.
- **Administradores:** todos têm o mesmo nível de acesso; criação e troca de senha são feitas por `pnpm admin:criar`.
- **Sessão:** não há encerramento remoto de uma sessão específica (trocar `AUTH_SECRET` encerra todas).
- **Histórico:** não há histórico de destinos anteriores de um cartão (apenas logs do servidor).
- **Exclusão:** cartões e lotes não podem ser excluídos pelo painel; use **Desativar**.
- **Domínios por tipo:** a lista de domínios aceitos para Instagram e Google fica em `src/modules/cards/destino.ts`
  e pode precisar de atualização se essas empresas criarem novos encurtadores.
