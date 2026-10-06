# Ativação do cartão pelo cliente

O cliente que comprou o cartão pode ativá-lo sozinho, pelo celular: aproxima o cartão (ou lê o QR Code),
deixa os dados de contato, informa o Instagram ou o link do Google da loja e confirma. O contato vai para a
seção **Contatos** do painel, como uma oportunidade de venda.

Nada muda no cartão físico: o QR Code e o chip NFC continuam contendo só a URL permanente.

## Como liberar

1. Configure na Vercel (*Settings → Environment Variables*, ambiente de produção) e faça um novo deploy:

   | Variável | O que é |
   |---|---|
   | `ATENDIMENTO_WHATSAPP` | WhatsApp de atendimento, com DDD. É para ele que vai o botão "Precisa trocar o link? Fale com a gente". |
   | `RESPONSAVEL_DADOS_NOME` | Nome ou razão social de quem responde pelos dados pessoais. |
   | `RESPONSAVEL_DADOS_DOCUMENTO` | CNPJ ou CPF (ex.: `CNPJ 00.000.000/0001-00`). |
   | `RESPONSAVEL_DADOS_EMAIL` | E-mail para pedidos sobre dados pessoais. |

   Sem as quatro, a opção não pode ser ligada em nenhum lote, e os cartões continuam como sempre.

2. Na página do lote, em **Ativação pelo cliente**, clique em **Ligar ativação pelo cliente**.

**Ligue só quando os cartões estiverem saindo para entrega.** Enquanto a opção está ligada, qualquer pessoa com
um cartão ainda não ativado daquele lote em mãos consegue ativá-lo. Lotes existentes e lotes novos começam com a
opção desligada. Só lotes de **Instagram** ou de **Google** aceitam a opção (é o tipo do lote que define qual
link o cliente informa). Desligar vale na hora.

## O que o cliente vê

Ao abrir `/c/CODIGO`:

| Situação do cartão | O que acontece |
|---|---|
| Configurado (ativo) | Redireciona como sempre, com a mesma consulta única ao banco |
| Não configurado, em lote com a opção ligada | Abre a ativação |
| Qualquer outro caso (lote sem a opção, cartão inativo, código inexistente) | As páginas de sempre |

A ativação tem a barra "Passo X de 4":

0. **Boas-vindas** — diz que leva menos de 1 minuto e se o cartão é de Instagram ou de Google.
1. **Sua loja** — nome da loja e ramo (opcional).
2. **Contato** — nome, função, quem decide (só se não for o dono), WhatsApp e a caixa, desmarcada, de aceite
   de mensagens, com o link "Como usamos seus dados".
3. **Link do cartão** — o `@` ou o link do perfil (Instagram), ou o link da empresa no Google, com uma ajuda de
   como achá-lo pelo celular.
4. **Confirmar** — "Seu cartão vai abrir: instagram.com/minhaloja", com "Está certo, ativar" e "Corrigir".

Depois: **"Cartão ativado!"**, com **Testar agora** e **Precisa trocar o link? Fale com a gente** (abre o WhatsApp
de atendimento já com o código do cartão na mensagem).

Detalhes que importam no balcão:

- Voltar (pelo botão da tela ou do navegador) não apaga o que foi digitado.
- Se o celular recarregar a aba enquanto a pessoa sai para copiar o link, os dados e o passo voltam.
- Funciona sem JavaScript: o formulário inteiro aparece de uma vez.
- A página é HTML puro e pequeno, para abrir rápido com internet ruim.

## Regras

- **Abrir a página nunca altera nada.** Robôs de pré-visualização (WhatsApp, por exemplo) também abrem links.
  A ativação só acontece no envio final (`POST`). O botão "Continuar" de cada passo só pede ao servidor que
  confira os campos; não grava nada.
- **Sem os dados de contato obrigatórios, o cartão não é ativado.** Loja, nome, função, WhatsApp e link são
  obrigatórios; ramo e aceite de ofertas são opcionais.
- **Ativação atômica.** Contato, link e mudança de estado são gravados na mesma transação, com a linha do cartão
  travada e a condição "ainda não configurado" na própria gravação. Se duas pessoas enviarem ao mesmo tempo, só
  a primeira vence; a segunda vê "Este cartão acabou de ser ativado."
- **Depois de ativado, a página pública não altera mais nada**, nem com reenvio do formulário nem com requisição
  montada à mão. Trocar o link é só pelo painel.
- **A ativação pelo painel continua igual**, sem exigir contato, em qualquer lote.
- **Nenhuma resposta de `/c/CODIGO` fica em cache** (`Cache-Control: no-store`): depois de ativado, o
  redirecionamento vale na hora.
- **Toda validação é feita no servidor.** O navegador só mostra o resultado.

### Validações

- **WhatsApp:** DDD existente; celular (9 dígitos, começando com 9) ou fixo (8 dígitos, começando de 2 a 5, para
  WhatsApp Business); aceita `+55`, zero na frente e qualquer formatação; é guardado como `+55DDDNÚMERO`.
- **Instagram:** aceita `@minhaloja`, `minhaloja` ou o link do perfil, e grava sempre
  `https://www.instagram.com/minhaloja/` (sem códigos de rastreio). Links de publicações, vídeos ou da página
  inicial são recusados.
- **Google:** usa a validação de destino que já existia, sem afrouxar nada. Ela aceita os formatos que o Google e
  o Google Maps compartilham: `g.page/r/…/review`, `maps.app.goo.gl/…`, `goo.gl/maps/…`, `share.google/…`,
  `g.co/kgs/…`, `google.com/maps/…` e `search.google.com/local/writereview?…`.
- Se a pessoa colar um texto com o nome da loja junto do link, só o link é usado.

### Robôs e limite de tentativas

- Um campo invisível ("isca") que pessoas não veem: se vier preenchido, nada é conferido nem gravado.
- Limites em `src/modules/activation/limite.ts`, por janela de 15 minutos:

  | O que | Por cartão | Por IP |
  |---|---|---|
  | Envio final | 8 | 20 |
  | Conferência de passo ("Continuar") | 60 | 120 |

- Os contadores ficam no banco (`limites_de_tentativas`), porque na Vercel cada requisição pode cair em uma
  instância diferente. O IP não é guardado em claro: só um resumo com segredo. Contadores vencidos são apagados.
- Recomenda-se também uma regra de *rate limit* para `/c/*` no Firewall da Vercel.

## Painel

- **Contatos** (menu, com o contador de **novos**): loja, nome, quem decide, WhatsApp, ramo, cartão, lote, tipo,
  data da ativação, aceite de ofertas e situação. Busca por loja, nome, WhatsApp ou cartão; filtros por lote,
  situação e aceite.
- **Situação:** Novo / Conversando / Virou cliente / Sem interesse, trocada direto na lista. Na página do contato
  há também o campo de **observação**.
- **"Esta loja tem 3 cartões"** aparece quando o mesmo WhatsApp ativou vários cartões.
- **Abrir conversa no WhatsApp** usa o link `wa.me` com o número em `+55`.
- **Exportar CSV:** respeita os filtros. Valores que começam com `=`, `+`, `-` ou `@` ganham um apóstrofo na
  frente, para a planilha não os tratar como fórmula (os nomes vêm de um formulário público).
- **Página do cartão:** mostra o contato de quem ativou. **Página do lote:** a opção e quantos cartões já foram
  ativados.
- Não há envio de e-mail (o projeto não tem provedor de e-mail): o aviso de novo contato é o contador no menu e
  o destaque no painel inicial.

## Privacidade (LGPD)

> **O texto "Como usamos seus dados" é um RASCUNHO e precisa ser revisado** por quem responde pelos dados, de
> preferência com apoio jurídico. O sistema não afirma conformidade com a LGPD.

- O texto fica em `src/modules/activation/privacidade.ts` e é exibido em `/privacidade`. Ele diz quem é o
  responsável (as variáveis `RESPONSAVEL_DADOS_*`), para que servem os dados (suporte do cartão e, se aceito,
  ofertas), por quanto tempo ficam guardados (o rascunho propõe 2 anos depois do último contato) e como pedir a
  exclusão.
- **Dados de contato** são obrigatórios para ativar e servem ao suporte do cartão. **O aceite de ofertas é
  opcional e começa desmarcado.** Use para ofertas só os contatos com "Aceitou ofertas: sim".
- Cada contato guarda a **versão do texto exibido**, **se o aceite foi marcado** e a **data e hora**. Ao mudar o
  texto, mude a constante `VERSAO_DO_TEXTO_DE_PRIVACIDADE`.
- **Exclusão a pedido do titular:** na página do contato, **Excluir dados do contato** apaga de vez nome, loja e
  WhatsApp. O cartão continua ativo e abrindo o mesmo link.
- Apagar um lote apaga os cartões, mas mantém os contatos (sem o cartão). Para apagar os dados, exclua o contato.
- O prazo de guarda não é aplicado automaticamente: não há rotina que apague contatos antigos.
- Os logs do servidor registram a ativação, a exportação e a exclusão sem nenhum dado pessoal.

## Limites conhecidos

- Só lotes de Instagram e de Google aceitam a opção; cartões avulsos (sem lote) não.
- Quem tiver o cartão em mãos antes do cliente pode ativá-lo: por isso a opção deve ser ligada só na entrega.
- A troca do link depois de ativado é só pelo painel (decisão de projeto).
- O link do Google não é aberto pelo sistema para conferir se é mesmo o da empresa do cliente: a confirmação é
  visual, no passo 4, e pelo botão "Testar agora".
