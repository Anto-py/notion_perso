import { defineConfig } from "drizzle-kit";

// drizzle-kit ne lit pas .env de lui-même ; en production les variables viennent de Coolify.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
