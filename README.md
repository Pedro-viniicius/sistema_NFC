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
| `pnpm impressao:modelos` | Recria as artes-base de impressão em `templates/` (não rode depois de trocar pela arte definitiva) |

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
5. **Região:** as funções rodam em São Paulo (`gru1`), definido em `vercel.json`. Crie o banco na mesma região
   (Neon `sa-east-1`); se o banco ficar em outro lugar, ajuste `regions` para a região mais próxima dele.
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

### Gerar os arquivos de produção para a gráfica
Na página do lote, **Gerar arquivos para gráfica**. A tela mostra o modelo (Google ou Instagram), a quantidade
de cartões, o status do lote e uma prévia esquemática, e oferece:

- **Baixar ZIP completo** — tudo o que a gráfica precisa;
- **Baixar PDF do lote** — uma página por cartão;
- **Baixar CSV** — o controle de produção.

```
lote-2026-001-google/
  lote-2026-001-google.pdf      uma página por cartão, na ordem do controle
  controle.csv                  numero,codigo,tipo,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr
  LEIA-ME.txt                   medidas, observações de impressão e instruções de gravação do NFC
  individuais/google-K8M4T2.pdf arte final de cada cartão
  qr/K8M4T2.svg                 QR Code avulso de cada cartão
```

Para um cartão avulso: página do cartão → **Baixar arte para impressão** (`google-K8M4T2.pdf`).

**Como enviar à gráfica:** mande o ZIP inteiro. Peça impressão em 100% (sem "ajustar à página"), corte em
86 × 54 mm e avise que **cada página é um cartão diferente**. Quem grava os chips usa o `controle.csv`:
localiza a linha pelo **código impresso abaixo do QR** e grava a URL da coluna `url_nfc`, que é sempre igual à `url_qr`.

Cada pacote tem no máximo **100 cartões**; lotes maiores aparecem divididos em partes (`...-parte-01`, `...-parte-02`),
com numeração contínua. O `controle.csv` usa vírgula como separador: no Excel em português, abra por
*Dados → De Texto/CSV*.

### Usar a sua própria arte (PDF)
*Artes* (menu do painel) → no modelo desejado, **Enviar arte própria**: escolha o PDF, informe onde fica a área
do QR Code (distância da esquerda, do topo e tamanho, em milímetros) e se o código do cartão deve ser impresso
em preto, em branco ou não ser impresso. Depois confira em **Ver amostra (PDF)**.

- O PDF deve ter **uma página** de **92 × 60 mm** (86 × 54 mm + 3 mm de sangria) ou **86 × 54 mm** (sem sangria),
  até 2 MB, sem senha e sem marcas de corte. O sistema não redimensiona a arte.
- Deixe livre na arte a área do QR Code: o sistema desenha ali um quadrado branco com o QR dentro.
- A arte vale para todos os cartões do modelo, inclusive lotes já criados.
- **Restaurar arte padrão** volta à arte-base do sistema.

Se o arquivo for recusado, a mensagem diz o motivo (não é PDF, tamanho diferente, mais de uma página, QR fora da
área etc.) e a arte anterior continua valendo.

### Apagar um lote
Página do lote → **Apagar lote** → digite o identificador do lote para confirmar. O lote e **todos os cartões
dele** são apagados e não há como desfazer: os QR Codes e chips NFC desses cartões passam a responder
"cartão não encontrado", mesmo que já estejam impressos ou vendidos. A tela avisa quantos cartões do lote
já estão configurados ou já receberam acessos. Use para lotes de teste ou gerados por engano.
Se o lote apagado era o mais recente do ano, o próximo lote criado reutiliza o mesmo número.

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
    printing/                  arte de impressão: modelos, PDF, controle e pacote de produção
    auth/                      senha (scrypt), token de sessão, login com bloqueio
  db/                          schema Drizzle e cliente PostgreSQL
  proxy.ts                     bloqueia /admin sem sessão (o "middleware" do Next 16)
drizzle/                       migrações SQL
templates/                     artes fixas de impressão (PDF) e contornos das letras do código
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
**`artes_de_impressao`** — arte enviada pelo painel, uma por modelo: `tipo`, `pdf`, `nome_do_arquivo`,
`tamanho_bytes`, posição do QR (`qr_x_mm`, `qr_y_mm`, `qr_tamanho_mm`) e `cor_do_codigo`.
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
| `/admin/lotes/[identificador]/exportar?formato=zip\|csv` | Admin | QR Codes do lote (SVG) e `lote.csv` |
| `/admin/cartoes/[codigo]/impressao?modelo=google\|instagram` | Admin | Arte final do cartão (PDF) |
| `/admin/artes` | Admin | Envio e restauração da arte de cada modelo |
| `/admin/artes/[slug]/amostra` | Admin | Amostra (PDF) da arte em uso |
| `/admin/lotes/[identificador]/grafica` | Admin | Tela de arquivos para a gráfica |
| `/admin/lotes/[identificador]/grafica/baixar?arquivo=pdf\|csv\|zip&modelo=&parte=` | Admin | PDF do lote, controle e ZIP |

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

## Arquivos de impressão

```
ARTE FIXA (templates/google.pdf)  +  QR DO CARTÃO  =  ARTE FINAL (google-K8M4T2.pdf)
```

### Arte fixa e dados variáveis
- **Arte fixa:** um PDF por modelo em `templates/` (fundo, textos, identidade, símbolo de aproximação).
  A aplicação nunca desenha a arte: só carrega esse PDF, sem redimensionar.
- **Dados variáveis:** o QR Code e o código do cartão, aplicados por cima.
- **Configuração central:** `src/modules/printing/modelos.ts` guarda, por modelo, o tamanho final, a sangria e a
  posição do QR e do código, em milímetros a partir do canto superior esquerdo do corte.
  Nenhuma rota conhece coordenadas. A conversão mm → pontos (72 pt por polegada, 25,4 mm por polegada) fica em `unidades.ts`.

| Medida | Valor |
|---|---|
| Tamanho final (corte) | 86 × 54 mm |
| Sangria | 3 mm em cada lado |
| Arte completa | 92 × 60 mm |
| Área do QR (com zona de silêncio) | 30 × 30 mm, a 50 mm da esquerda e 6 mm do topo do corte |
| Código do cartão | 6,5 pt, centralizado abaixo do QR |

As páginas trazem `TrimBox` (corte) e `BleedBox` (sangria). Não há marcas de corte: a gráfica faz a imposição.

### QR Code vetorial
O módulo `qr` gera a **matriz** do QR a partir do código do cartão; o gerador de PDF desenha os módulos escuros
como retângulos em um único preenchimento. Sem imagem bitmap, sem arredondamento, sem rotação, sem logotipo.
Preto puro (só o canal K) sobre uma caixa branca que cobre a zona de silêncio de 4 módulos, para o contraste
não depender da arte. A geração é recusada se os módulos ficarem menores que 0,5 mm (por exemplo, com um domínio muito longo).

O gerador recebe **apenas o código do cartão** e obtém a URL por `getCardPublicUrl`: o destino configurado
não chega até ele. Os testes abrem o PDF gerado, reconstroem o QR a partir dos retângulos desenhados e leem o conteúdo.

### Código impresso na arte (rastreabilidade)
O código do cartão é impresso em tamanho pequeno abaixo do QR. É uma decisão de produto: a ativação rápida
pede o código impresso, e é ele que liga o adesivo ao chip NFC e à linha do `controle.csv`, evitando gravar
o NFC de um cartão no adesivo de outro. Para um produto que não possa exibir o código, defina `codigo: null`
no modelo; ele continua no `controle.csv`.

### Qual arte um cartão usa
A arte segue o **tipo do lote** (que define o adesivo fabricado); cartão sem lote usa o próprio tipo.
Em qualquer download é possível escolher o modelo com `?modelo=google|instagram`. Tipos sem arte
("Outro link" ou sem tipo) exigem essa escolha.

### Arte padrão e arte enviada
As artes de `templates/` são **artes-base neutras**, geradas por `pnpm impressao:modelos`, com texto convertido em
curvas e sem logotipos oficiais (Google e Instagram são marcas registradas; a identidade definitiva deve vir do
designer, seguindo as regras de cada marca).

A arte definitiva é enviada pelo painel, em **Artes** (veja "Usar a sua própria arte"). Ela fica no banco
(tabela `artes_de_impressao`), porque a Vercel não tem disco persistente, e passa a valer no lugar da arte-base
junto com a posição do QR informada no envio. O código do cartão fica sempre centralizado logo abaixo do QR.

Antes de gravar, o sistema gera de verdade um cartão de amostra com o PDF enviado. Se o arquivo não for um PDF
válido de uma página, tiver tamanho diferente de 92 × 60 mm ou 86 × 54 mm, deixar o QR fora da área segura ou
com módulos menores que 0,5 mm, nada é salvo. Arte sem sangria é aceita com aviso: ela é posicionada dentro do
corte e a faixa de sangria fica sem impressão.

### Limitações de pré-impressão (PDF/X e CMYK)
O sistema entrega PDF vetorial, com dimensões físicas corretas, sangria, caixas de corte e QR vetorial,
usando cores CMYK de dispositivo. **Não é um PDF/X-1a nem PDF/X-4 certificado:** não há perfil ICC embutido,
*output intent*, controle de sobreimpressão nem validação de pré-impressão, e a biblioteca usada (pdf-lib) não faz isso.
Se a gráfica exigir PDF/X, um perfil de cor específico ou marcas de corte, é preciso uma etapa de pré-impressão
(por exemplo, no Acrobat ou no fluxo da própria gráfica). Em material transparente ou metalizado, o branco atrás
do QR precisa de tinta branca, o que também é definido na pré-impressão.

### Limite por pacote e Vercel
Tudo é gerado em memória a partir do banco e devolvido como download; nada é gravado em disco e não há
dependência de binários do sistema. As artes de `templates/` são empacotadas com as funções do painel
(`outputFileTracingIncludes` em `next.config.ts`).

Medição em Node 22 com a arte-base: 100 cartões → ZIP de 2,2 MB em 0,6 s, com cerca de 30 MB de memória;
250 cartões → 5,4 MB, acima do limite de 4,5 MB por resposta das funções da Vercel. Por isso o pacote tem no
máximo 100 cartões.

Cada PDF individual carrega a arte inteira, então uma arte enviada mais pesada aumenta o ZIP na mesma proporção.
Quando os individuais não cabem em 3,5 MB, o ZIP sai **sem a pasta `individuais/`** e o `LEIA-ME.txt` avisa;
o PDF do lote (que embute a arte uma única vez) tem as mesmas páginas, e a arte de um cartão continua
disponível na página dele. O envio recusa artes que passem de 2 MB ou de 3 MB por cartão depois de processadas.

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

`pnpm test` roda 222 testes contra um PostgreSQL em memória (PGlite) com as migrações reais:

- geração e validação de código (formato, alfabeto, unicidade, rejeição de inválidos);
- URL canônica e configuração de domínio;
- validação de destino (Instagram, Google, genérico; `javascript:`, `data:`, `file:` etc.);
- criação, configuração, ativação e desativação de cartões; código duplicado e código imutável no banco;
- todos os estados de `/c/[codigo]` e a contagem de acessos;
- QR Code (o teste lê o QR gerado e confere o conteúdo);
- lotes, CSV e ZIP;
- senha, sessão, bloqueio de login e proteção do painel;
- impressão: conversão mm → pontos, dimensões e caixas do PDF, posição e conteúdo do QR lido de dentro do PDF,
  arte correta por modelo, PDF do lote, controle, ZIP, limite por pacote e downloads sem sessão;
- regressão crítica de impressão: trocar o destino não altera o QR do PDF;
- arte enviada: uso só no modelo certo, posição do QR, arte sem sangria, arquivos recusados, restauração e
  pacote com arte pesada;
- exclusão de lote: apaga lote e cartões, exige confirmação e não afeta outros lotes;
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
- **Exclusão:** um lote pode ser apagado inteiro (com todos os seus cartões); um cartão isolado não pode ser
  excluído pelo painel — use **Desativar**. Não há lixeira: a exclusão é definitiva.
- **Impressão:** os PDFs não são PDF/X certificados e as artes incluídas são artes-base
  (veja "Arquivos de impressão"). Há uma arte por modelo (Google e Instagram), não por lote, e não há modelo
  para o tipo "Outro link". Não há histórico das artes enviadas: enviar uma nova substitui a anterior.
- **Domínios por tipo:** a lista de domínios aceitos para Instagram e Google fica em `src/modules/cards/destino.ts`
  e pode precisar de atualização se essas empresas criarem novos encurtadores.
