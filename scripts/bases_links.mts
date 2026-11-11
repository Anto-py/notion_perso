// npm run bases:liens : les bases de la page « Bases de données » passent
// d'encastrées à des liens icône + nom (choix d'Antonin du 2026-11-11), sur la
// base désignée par DATABASE_URL. À blanc par défaut ; --write applique et pose
// le marqueur. Refuse de tourner sur le Mac, qui reçoit le corps par la
// synchronisation. Le serveur la joue aussi seul au démarrage, une fois.
//   DATABASE_URL=postgres://…/copie_prod npm run bases:liens
//   DATABASE_URL=postgres://…/copie_prod npm run bases:liens -- --write
import { drizzle } from "drizzle-orm/node-postgres";
import { basesLinksDone, describeLinksRun, runBasesLinks } from "../src/lib/bases_links_query.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run bases:liens [-- --write]");
  process.exit(1);
}
if (process.env.SYNC_REMOTE_URL) {
  console.error("Bases en liens : à jouer sur le serveur, pas sur le Mac (la synchronisation porte le corps).");
  process.exit(1);
}

const write = process.argv.includes("--write");
const database = drizzle(DATABASE_URL);

try {
  console.log(`Bases en liens sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  if (await basesLinksDone(database)) {
    console.log("Déjà faite (marqueur présent) : le serveur ne la rejouera pas.");
  }
  const run = await runBasesLinks(database, { write });
  console.log(describeLinksRun(run));
  if (!write) {
    console.log("Rien n'a été écrit. Relancer avec --write pour appliquer.");
    process.exit(0);
  }
  const again = await runBasesLinks(database, { write: false });
  if (again.plan?.changed) {
    console.error("Attention : le second passage trouve encore des vues liées, vérifier la page racine.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
