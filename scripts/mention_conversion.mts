// npm run mentions:convertir : les liens nus des pages ordinaires deviennent
// des mentions titrées (étape 22, palier d), sur la base désignée par
// DATABASE_URL. À blanc par défaut ; --write applique et pose le marqueur.
// Refuse de tourner sur le Mac, qui reçoit le corps par la synchronisation.
// Le serveur la joue aussi seul au démarrage, une fois, en tâche de fond.
//   DATABASE_URL=postgres://…/copie_prod npm run mentions:convertir
//   DATABASE_URL=postgres://…/copie_prod npm run mentions:convertir -- --write
import { drizzle } from "drizzle-orm/node-postgres";
import {
  describeMentionConversion,
  mentionsConversionDone,
  runMentionConversion,
} from "../src/lib/mention_conversion_query.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run mentions:convertir [-- --write]");
  process.exit(1);
}
if (process.env.SYNC_REMOTE_URL) {
  console.error("Mentions de sites : à jouer sur le serveur, pas sur le Mac (la synchronisation porte le corps).");
  process.exit(1);
}

const write = process.argv.includes("--write");
const database = drizzle(DATABASE_URL);

try {
  console.log(`Mentions de sites sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  if (await mentionsConversionDone(database)) {
    console.log("Marqueur déjà posé : le démarrage ne la rejouera pas.");
  }
  const started = Date.now();
  const run = await runMentionConversion(database, { write });
  console.log(describeMentionConversion(run));
  for (const page of run.plan.pages) {
    console.log(`- ${page.id} : ${page.links} lien(s), ${page.urls.length} adresse(s)`);
  }
  console.log(`Durée : ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  if (!write) {
    console.log("Rien n'a été écrit. Relancer avec --write pour appliquer.");
    process.exit(0);
  }
  const again = await runMentionConversion(database, { write: false });
  if (again.plan.pages.length) {
    console.error("Attention : un second passage trouve encore des liens nus, vérifier ces pages.");
    process.exit(1);
  }
  console.log("Second passage : rien à convertir.");
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
