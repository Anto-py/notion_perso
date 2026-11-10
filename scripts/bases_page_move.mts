// npm run bases:page : conversion de la racine des bases (étape 17, palier c)
// sur la base désignée par DATABASE_URL. À blanc par défaut ; --write applique
// les écritures en une transaction. Refuse de tourner sur le Mac, qui reçoit la
// conversion par la synchronisation ordinaire. Le serveur la joue aussi seul au
// démarrage, une fois, quand le rôle est encore porté par un dossier.
//   DATABASE_URL=postgres://…/copie_prod npm run bases:page
//   DATABASE_URL=postgres://…/copie_prod npm run bases:page -- --write
import { drizzle } from "drizzle-orm/node-postgres";
import { basesPageConverted, describeConversion, runBasesPageMove } from "../src/lib/bases_page_move_query.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run bases:page [-- --write]");
  process.exit(1);
}
if (process.env.SYNC_REMOTE_URL) {
  console.error("Racine des bases : à jouer sur le serveur, pas sur le Mac (la synchronisation porte la conversion).");
  process.exit(1);
}

const write = process.argv.includes("--write");
const database = drizzle(DATABASE_URL);

try {
  const run = await runBasesPageMove(database, { write });
  console.log(`Conversion sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  console.log(describeConversion(run));
  if (!write) {
    console.log(run.changes > 0 ? "Rien n'a été écrit. Relancer avec --write pour appliquer." : "Rien à convertir : la racine est déjà en place.");
    process.exit(0);
  }
  if (run.changes === 0) {
    console.log("Rien à convertir : aucune écriture.");
    process.exit(0);
  }
  if (!(await basesPageConverted(database))) {
    console.error("Après écriture, aucune page ne porte le rôle : vérifier la page racine.");
    process.exit(1);
  }
  const again = await runBasesPageMove(database, { write: false });
  console.log(describeConversion(again));
  if (again.plan.report.moves || again.plan.report.added || again.plan.report.trashedPages || again.plan.report.roleChanged) {
    console.error("Attention : le second passage trouve encore du travail, vérifier la page racine.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
