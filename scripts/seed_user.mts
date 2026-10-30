// npm run db:seed : crée le compte unique depuis INITIAL_USERNAME et
// INITIAL_PASSWORD. Sans effet si un compte existe déjà : relançable sans risque.
import { drizzle } from "drizzle-orm/node-postgres";
import { ensureAccount } from "../src/lib/account.ts";

const { DATABASE_URL, INITIAL_USERNAME, INITIAL_PASSWORD } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL est requise (voir .env.example)");
  process.exit(1);
}

try {
  const { created, username } = await ensureAccount(drizzle(DATABASE_URL), INITIAL_USERNAME, INITIAL_PASSWORD);
  console.log(created ? `Compte « ${username} » créé.` : `Un compte existe déjà (${username}), rien à faire.`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
