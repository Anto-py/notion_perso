// Pages qui portent un encadré de conflit, pour la liste « Conflits à trier »
// (BRAINSTORMING §11, « Conflits »). La fusion (lib/sync_merge.ts) pose un
// bloc de type `conflict` dans le corps ; `$.**` atteint ceux qui sont
// imbriqués dans les colonnes.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type ConflictPage = { id: string; title: string; type: string };

const HAS_CONFLICT = sql`trashed_at IS NULL AND jsonb_path_exists(body, '$.** ? (@.type == "conflict")')`;

export async function listConflictPages(): Promise<ConflictPage[]> {
  const result = await db.execute<ConflictPage>(sql`
    SELECT id, title, type FROM pages WHERE ${HAS_CONFLICT} ORDER BY lower(title)`);
  return result.rows;
}

export async function countConflicts(): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM pages WHERE ${HAS_CONFLICT}`);
  return Number(result.rows[0]?.count ?? 0);
}
