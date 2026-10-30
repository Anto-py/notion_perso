// Le compte unique, créé seulement si aucun compte n'existe : relançable sans
// risque. Partagé par npm run db:seed et le démarrage en production
// (db/bootstrap.ts). Extensions .ts explicites : le script de seed tourne sous
// Node seul (--experimental-strip-types), sans résolution de bundler.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.ts";
import { newId } from "./ids.ts";
import { hashPassword } from "./password.ts";

export async function ensureAccount<T extends Record<string, unknown>>(
  db: NodePgDatabase<T>,
  username: string | undefined,
  password: string | undefined,
): Promise<{ created: boolean; username: string }> {
  const existing = await db.select({ username: users.username }).from(users).limit(1);
  if (existing.length) return { created: false, username: existing[0].username };

  const name = username?.trim();
  if (!name || !password) {
    throw new Error("Aucun compte : INITIAL_USERNAME et INITIAL_PASSWORD sont requis pour le créer");
  }
  await db.insert(users).values({
    id: newId("us"),
    username: name,
    passwordHash: await hashPassword(password),
  });
  return { created: true, username: name };
}
