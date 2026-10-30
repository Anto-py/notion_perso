// Vérifie que Drizzle atteint la base de DATABASE_URL. Sortie non nulle sinon.
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante (voir .env.example)");
  process.exit(1);
}

const db = drizzle(url);
try {
  const { rows } = await db.execute(sql`select current_database() as base, version() as version`);
  console.log(`Connecté à ${rows[0].base} : ${String(rows[0].version).split(" on ")[0]}`);
  process.exit(0);
} catch (err) {
  console.error(`Connexion impossible : ${(err as Error).message}`);
  process.exit(1);
}
