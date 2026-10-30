// npm run db:seed : crée le compte unique depuis INITIAL_USERNAME et
// INITIAL_PASSWORD. Sans effet si un compte existe déjà : relançable sans risque.
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../src/db/schema.ts";
import { newId } from "../src/lib/ids.ts";
import { hashPassword } from "../src/lib/password.ts";

const { DATABASE_URL, INITIAL_USERNAME, INITIAL_PASSWORD } = process.env;
if (!DATABASE_URL || !INITIAL_USERNAME || !INITIAL_PASSWORD) {
  console.error("DATABASE_URL, INITIAL_USERNAME et INITIAL_PASSWORD sont requis (voir .env.example)");
  process.exit(1);
}

const db = drizzle(DATABASE_URL);
const existing = await db.select({ username: users.username }).from(users).limit(1);
if (existing.length) {
  console.log(`Un compte existe déjà (${existing[0].username}), rien à faire.`);
  process.exit(0);
}

await db.insert(users).values({
  id: newId("us"),
  username: INITIAL_USERNAME.trim(),
  passwordHash: await hashPassword(INITIAL_PASSWORD),
});
console.log(`Compte « ${INITIAL_USERNAME.trim()} » créé.`);
process.exit(0);
