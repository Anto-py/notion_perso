// Conversion de la racine des bases sur la base vive (étape 17, palier c).
// Module serveur : lit les pages, demande le plan pur (bases_page_move.ts) et
// l'écrit en une transaction. Appelé par le démarrage du serveur quand le rôle
// est encore porté par un dossier, et par le script `bases_page_move.mts`.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pages } from "../db/schema.ts";
import { describePlan, planBasesPage, type ConvertRow, type ConversionPlan } from "./bases_page_move.ts";

export type ConversionRun = { plan: ConversionPlan; titles: Map<string, string>; changes: number; written: boolean };

type Row = {
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

// Vrai quand une page porte déjà le rôle : la conversion est faite, et le
// démarrage ne la rejoue pas (elle jetterait une page « To Do » neuve).
export async function basesPageConverted<T extends Record<string, unknown>>(database: NodePgDatabase<T>): Promise<boolean> {
  const [row] = await database
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.isBasesRoot, true), eq(pages.type, "page"), isNull(pages.trashedAt)))
    .limit(1);
  return row !== undefined;
}

export async function runBasesPageMove<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  { write }: { write: boolean },
): Promise<ConversionRun> {
  return database.transaction(async (tx) => {
    const result = await tx.execute<Row>(sql`
      SELECT p.id, p.parent_id, p.type, p.title, p.icon, p.cover, p.cover_position, p.body,
             p.trashed_at, p.is_bases_root, p.is_inbox, p.manual_order,
             (SELECT count(*) FROM pages e
               WHERE e.db_id = p.id AND e.type = 'entry' AND e.trashed_at IS NULL)::int AS live_entries
      FROM pages p`);
    const rows: ConvertRow[] = result.rows.map((row) => ({
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
    const titles = new Map(rows.map((row) => [row.id, row.title]));
    const plan = planBasesPage(rows);
    const changes =
      plan.report.transfers +
      plan.report.moves +
      plan.report.duplicates +
      plan.report.embedded +
      plan.report.replaced +
      plan.report.added +
      plan.report.trashedPages +
      Number(plan.report.roleChanged);
    if (!write || changes === 0) return { plan, titles, changes, written: false };

    const now = new Date();
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
    return { plan, titles, changes, written: true };
  });
}

// Une ligne de journal par passage, lue au déploiement dans les journaux du
// conteneur.
export function describeConversion({ plan, titles, written }: ConversionRun): string {
  const header = written ? "Conversion de la racine des bases faite." : "Conversion de la racine des bases : rien à changer.";
  return [header, ...describePlan(plan, titles)].join("\n");
}
