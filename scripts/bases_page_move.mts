// npm run bases:page : conversion de la racine des bases (étape 17, palier c)
// sur la base désignée par DATABASE_URL. À blanc par défaut ; --write applique
// les écritures en une transaction. Refuse de tourner sur le Mac, qui reçoit la
// conversion par la synchronisation ordinaire.
//   DATABASE_URL=postgres://…/copie_prod npm run bases:page
//   DATABASE_URL=postgres://…/copie_prod npm run bases:page -- --write
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pages } from "../src/db/schema.ts";
import { describePlan, planBasesPage, type ConvertRow, type ConversionPlan } from "../src/lib/bases_page_move.ts";

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
const now = new Date();

type DbRow = {
  id: string;
  parent_id: string | null;
  type: ConvertRow["type"];
  title: string;
  icon: string | null;
  cover: string | null;
  cover_position: number | null;
  body: unknown;
  trashed_at: Date | null;
  is_bases_root: boolean;
  is_inbox: boolean;
  manual_order: string;
  live_entries: number;
};

async function readRows(): Promise<ConvertRow[]> {
  const result = await database.execute<DbRow>(sql`
    SELECT p.id, p.parent_id, p.type, p.title, p.icon, p.cover, p.cover_position, p.body,
           p.trashed_at, p.is_bases_root, p.is_inbox, p.manual_order,
           (SELECT count(*) FROM pages e
             WHERE e.db_id = p.id AND e.type = 'entry' AND e.trashed_at IS NULL)::int AS live_entries
    FROM pages p`);
  return result.rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    type: row.type,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    coverPosition: row.cover_position,
    body: row.body,
    trashed: row.trashed_at !== null,
    isBasesRoot: row.is_bases_root,
    isInbox: row.is_inbox,
    liveEntries: Number(row.live_entries),
    manualOrder: row.manual_order,
  }));
}

async function apply(plan: ConversionPlan): Promise<void> {
  await database.transaction(async (tx) => {
    // Le rôle d'abord : l'index unique partiel n'admet qu'une ligne
    // `is_bases_root`, corbeille comprise. On le retire à l'ancien dossier
    // avant de le poser sur la page.
    if (plan.oldRootId) {
      await tx.update(pages).set({ isBasesRoot: false, trashedAt: now, updatedAt: now }).where(eq(pages.id, plan.oldRootId));
    }
    for (const [id, patch] of plan.bases) {
      const set: Record<string, unknown> = { updatedAt: now };
      if (patch.parentId !== undefined) set.parentId = patch.parentId;
      if (patch.icon !== undefined) set.icon = patch.icon;
      if (patch.cover !== undefined) set.cover = patch.cover;
      if (patch.coverPosition !== undefined) set.coverPosition = patch.coverPosition;
      if (patch.trash) set.trashedAt = now;
      await tx.update(pages).set(set).where(eq(pages.id, id));
    }
    if (plan.page.bodyChanged || plan.page.roleChanged) {
      const set: Record<string, unknown> = { updatedAt: now };
      if (plan.page.bodyChanged) {
        set.body = plan.page.body;
        set.bodyText = plan.page.bodyText;
      }
      if (plan.page.roleChanged) set.isBasesRoot = true;
      await tx.update(pages).set(set).where(eq(pages.id, plan.rootId));
    }
    if (plan.trashPageIds.length > 0) {
      await tx.update(pages).set({ trashedAt: now, updatedAt: now }).where(inArray(pages.id, plan.trashPageIds));
    }
  });
}

try {
  const rows = await readRows();
  const titles = new Map(rows.map((row) => [row.id, row.title]));
  const plan = planBasesPage(rows);
  console.log(`Conversion sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  for (const line of describePlan(plan, titles)) console.log(line);
  const changes = plan.report.transfers + plan.report.moves + plan.report.duplicates + plan.report.embedded + plan.report.replaced + plan.report.added + plan.report.trashedPages + Number(plan.report.roleChanged);
  if (!write) {
    console.log(changes > 0 ? "Rien n'a été écrit. Relancer avec --write pour appliquer." : "Rien à convertir : la racine est déjà en place.");
    process.exit(0);
  }
  if (changes === 0) {
    console.log("Rien à convertir : aucune écriture.");
    process.exit(0);
  }
  await apply(plan);
  const again = planBasesPage(await readRows());
  console.log("Écriture faite. Second passage : rien à changer.");
  if (again.report.moves || again.report.added || again.report.trashedPages || again.report.roleChanged) {
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
