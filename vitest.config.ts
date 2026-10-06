import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" lança erro fora do bundler do Next; nos testes vira um módulo vazio.
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_APP_URL: "https://go.example.com",
      AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres-0123456789",
    },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
