// Démarrage en production (MIGRATE_ON_START=1, posé par le Dockerfile) : les
// migrations, puis le compte unique, avant que le serveur réponde. Les deux
// sont idempotents. Un échec arrête le processus, plutôt que de servir sur un
// schéma incomplet ; process.exit vit ici et non dans instrumentation.ts, que
// Turbopack analyse aussi pour l'Edge Runtime. Le dossier des migrations est
// copié dans l'image à côté de server.js (voir Dockerfile, cible runner).
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ensureAccount } from "@/lib/account";
import { db } from "./index";

export async function bootstrap() {
  try {
    await migrate(db, {
      migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "src/db/migrations"),
    });
    const { created, username } = await ensureAccount(
      db,
      process.env.INITIAL_USERNAME,
      process.env.INITIAL_PASSWORD,
    );
    console.log(created ? `Compte « ${username} » créé.` : "Migrations à jour, compte existant.");
  } catch (error) {
    console.error("Démarrage interrompu, migrations ou compte unique en échec :", error);
    process.exit(1);
  }
}
