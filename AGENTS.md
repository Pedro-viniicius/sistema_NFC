<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Convenções deste projeto

- **Idioma:** toda comunicação, documentação, texto de interface, mensagens de validação e mensagens de commit
  em português do Brasil (pt-BR). Identificadores de código podem ser em inglês quando fizer sentido.
- **Invariante central:** QR Code e NFC contêm sempre a URL permanente do cartão (`getCardPublicUrl`), nunca o destino.
  Não monte URLs de cartão manualmente e não crie caminhos que alterem `cartoes.codigo`.
- **Regras de negócio** ficam em `src/modules` (sem depender do Next.js); `src/app` só orquestra.
- **Antes de cada commit:** `pnpm lint && pnpm typecheck && pnpm test`.
- **Banco:** mudanças de estrutura só por migração (`pnpm db:generate` + `pnpm db:migrate`).
- **Impressão (lotes sem template):** a arte fixa fica em `templates/`; medidas e posição do QR ficam só em
  `src/modules/printing/modelos.ts`. O gerador de PDF recebe apenas códigos de cartão, nunca o destino.
- **Templates de impressão** (`src/modules/templates`, documentação em `docs/templates-impressao.md`):
  o PDF enviado nunca é alterado — a única coisa acrescentada é o QR. Posições são gravadas só em pontos do PDF
  (origem embaixo, à esquerda); toda conversão passa por `coordenadas.ts`. `renderTemplatePdf` é o único
  gerador e só aceita a URL permanente de um cartão. Um arquivo armazenado nunca é sobrescrito, e um template
  usado por um lote não muda mais (arquivo e área do QR).
- **Arquivos:** nada persiste no disco da Vercel. Use a interface de `src/modules/storage` (Vercel Blob privado);
  o envio do PDF vai do navegador direto para o Blob, nunca por uma função ou Server Action.
- **Rota pública `/c/[codigo]`:** `GET` nunca grava nada no cartão (robôs de pré-visualização abrem links) e
  nenhuma resposta pode ficar em cache. O único caminho público que grava é o `POST` da ativação pelo cliente
  (`src/modules/activation`), e só enquanto o cartão está "não configurado", em uma transação.
- **Dados pessoais** (tabela `contatos`): nunca vão para logs. Textos mostrados ao cliente na ativação usam
  linguagem de balcão: nada de "URL", "destino", "redirecionamento" ou "lead".
