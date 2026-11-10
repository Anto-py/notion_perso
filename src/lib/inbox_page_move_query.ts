// Conversion du Vide-cerveau sur la base vive (étape 18, palier c). Module
// serveur : lit la ligne `is_inbox`, demande le plan pur (inbox_page_move.ts)
// et l'écrit en une transaction. Appelé par le démarrage du serveur quand le
// rôle est encore porté par une base, par `ensureInbox` à la première visite,
// et par le script `inbox_page_move.mts`.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pages } from "../db/schema.ts";
import { planInboxPage, type InboxPlan, type InboxRow } from "./inbox_page_move.ts";

export { describeInboxPlan } from "./inbox_page_move.ts";

export type InboxRun = { plan: InboxPlan; written: boolean };

type Row = {
  id: string;
  type: InboxRow["type"];
  trashed_at: Date | null;
  is_inbox: boolean;
  entries: number;
};

// Vrai quand rien ne reste à convertir : page déjà en place, ou aucune ligne
// (la page sera créée à la première visite).
export async function inboxPageConverted<T extends Record<string, unknown>>(database: NodePgDatabase<T>): Promise<boolean> {
  const [row] = await database
    .select({ type: pages.type })
    .from(pages)
    .where(and(eq(pages.isInbox, true), isNull(pages.trashedAt)))
    .limit(1);
  return !row || row.type === "page";
}

export async function runInboxPageMove<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  { write }: { write: boolean },
): Promise<InboxRun> {
  return database.transaction(async (tx) => {
    const result = await tx.execute<Row>(sql`
      SELECT p.id, p.type, p.trashed_at, p.is_inbox,
             (SELECT count(*) FROM pages e WHERE e.db_id = p.id AND e.type = 'entry')::int AS entries
      FROM pages p
      WHERE p.is_inbox`);
    const rows: InboxRow[] = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      trashed: row.trashed_at !== null,
      isInbox: row.is_inbox,
      entries: Number(row.entries),
    }));
    const plan = planInboxPage(rows);
    if (!write || !plan.convert || !plan.inboxId) return { plan, written: false };

    const now = new Date();
    // Les entrées partent avant la ligne : aucune n'a de sens hors de la base.
    await tx.delete(pages).where(and(eq(pages.dbId, plan.inboxId), eq(pages.type, "entry")));
    await tx
      .update(pages)
      .set({
        type: "page",
        parentId: null,
        dbConfig: null,
        body: [],
        bodyText: "",
        inboxKind: null,
        updatedAt: now,
      })
      .where(eq(pages.id, plan.inboxId));
    return { plan, written: true };
  });
}
