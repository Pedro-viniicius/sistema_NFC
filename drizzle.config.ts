import { defineConfig } from "drizzle-kit";

// O drizzle-kit roda fora do Next.js, então carregamos o .env.local manualmente.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Sem .env.local (ex.: CI ou Vercel): usa as variáveis já presentes no ambiente.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
