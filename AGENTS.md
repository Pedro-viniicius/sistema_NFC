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
- **Impressão:** a arte fixa fica em `templates/`; medidas e posição do QR ficam só em `src/modules/printing/modelos.ts`.
  O gerador de PDF recebe apenas códigos de cartão, nunca o destino.
