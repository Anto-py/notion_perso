// npm run inbox:page : conversion du Vide-cerveau (étape 18, palier c) sur la
// base désignée par DATABASE_URL. À blanc par défaut ; --write applique les
// écritures en une transaction. Refuse de tourner sur le Mac, qui reçoit la
// conversion par la synchronisation ordinaire. Le serveur la joue aussi seul au
// démarrage, une fois, quand le rôle est encore porté par une base.
//   DATABASE_URL=postgres://…/copie_prod npm run inbox:page
//   DATABASE_URL=postgres://…/copie_prod npm run inbox:page -- --write
import { drizzle } from "drizzle-orm/node-postgres";
import {
  describeInboxPlan,
  inboxPageConverted,
  runInboxPageMove,
} from "../src/lib/inbox_page_move_query.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run inbox:page [-- --write]");
  process.exit(1);
}
if (process.env.SYNC_REMOTE_URL) {
  console.error("Vide-cerveau : à jouer sur le serveur, pas sur le Mac (la synchronisation porte la conversion).");
  process.exit(1);
}

const write = process.argv.includes("--write");
const database = drizzle(DATABASE_URL);

try {
  const run = await runInboxPageMove(database, { write });
  console.log(`Conversion sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  console.log(describeInboxPlan(run.plan));
  if (!write) {
    const nothing = run.plan.report.found
      ? "Rien à convertir : le Vide-cerveau est déjà une page."
      : "Rien à convertir : aucun Vide-cerveau.";
    console.log(run.plan.convert ? "Rien n'a été écrit. Relancer avec --write pour appliquer." : nothing);
    process.exit(0);
  }
  if (!run.written) {
    console.log("Rien à convertir : aucune écriture.");
    process.exit(0);
  }
  if (!(await inboxPageConverted(database))) {
    console.error("Après écriture, le Vide-cerveau n'est pas une page.");
    process.exit(1);
  }
  const again = await runInboxPageMove(database, { write: false });
  console.log(describeInboxPlan(again.plan));
  if (again.plan.convert) {
    console.error("Attention : le second passage trouve encore du travail.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
