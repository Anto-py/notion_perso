// npm run bases:demenager : joue à blanc le déménagement des bases dans
// « Bases » (étape 16, palier c) sur la base désignée par DATABASE_URL, et dit
// ce que le démarrage du serveur y ferait. N'écrit rien : le passage réel est
// celui du démarrage (src/instrumentation.ts), le chemin même de la production.
//   DATABASE_URL=postgres://…/copie_prod npm run bases:demenager
import { drizzle } from "drizzle-orm/node-postgres";
import { describeBases, describeRun, runBasesMove } from "../src/lib/bases_move_query.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run bases:demenager");
  process.exit(1);
}

const database = drizzle(DATABASE_URL);
try {
  const run = await runBasesMove(database, { write: false });
  console.log(`Essai à blanc sur ${new URL(DATABASE_URL).pathname.slice(1)}, rien n'est écrit.`);
  console.log(describeRun(run));
  for (const line of describeBases(run)) console.log(line);
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
