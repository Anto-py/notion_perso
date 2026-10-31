// npm run sync:jeton -- "<nom>" : crée un client de synchronisation (l'app
// Mac) et affiche son jeton, une seule fois : la base n'en garde que
// l'empreinte. Révoquer : DELETE FROM sync_clients WHERE name = '<nom>'.
import { drizzle } from "drizzle-orm/node-postgres";
import { syncClients } from "../src/db/schema.ts";
import { hashToken, newId, newToken } from "../src/lib/ids.ts";

const { DATABASE_URL } = process.env;
const name = process.argv[2]?.trim();
if (!DATABASE_URL || !name) {
  console.error('Usage : DATABASE_URL=… npm run sync:jeton -- "<nom du client>"');
  process.exit(1);
}

try {
  const token = newToken();
  await drizzle(DATABASE_URL).insert(syncClients).values({ id: newId("sc"), name, tokenHash: hashToken(token) });
  console.log(`Client « ${name} » créé. Jeton, à garder au trousseau (il ne sera plus affiché) :\n${token}`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
