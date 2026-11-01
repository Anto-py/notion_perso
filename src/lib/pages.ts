// Accès aux pages : arbre, création, modification, déplacement, corbeille.
// Ce module ne décide d'aucun droit : chaque appelant passe d'abord par
// canAccess (lib/access.ts), point unique des décisions d'accès.
import { and, asc, desc, eq, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, pages } from "@/db/schema";
import { flattenToText } from "./blocks";
import { newId } from "./ids";
import { emptyConfig } from "./views";
import { wouldCreateCycle, type TreeRow } from "./tree";
import { mergeWebSave, type WebFields } from "./web_save";

export const TRASH_RETENTION_DAYS = 30;

export type Page = typeof pages.$inferSelect;

export type Outcome = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

const NOT_FOUND: Outcome = { ok: false, status: 404, error: "Page introuvable" };

// Pages et bases, hors corbeille. Les entrées de base vivent dans leur base,
// pas dans la sidebar ; le Vide-cerveau y est épinglé à part, jamais dans
// l'arbre.
export async function listTreeRows(): Promise<TreeRow[]> {
  return db
    .select({ id: pages.id, parentId: pages.parentId, type: pages.type, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(isNull(pages.trashedAt), ne(pages.type, "entry"), eq(pages.isInbox, false)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

// Bases hors corbeille, pour le menu « Déplacer vers » d'une entrée.
export async function listDatabases(): Promise<{ id: string; title: string; icon: string | null }[]> {
  return db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.type, "database"), isNull(pages.trashedAt)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

// Accueil : pages modifiées en dernier.
export async function listRecent(limit = 10) {
  return db
    .select({ id: pages.id, type: pages.type, title: pages.title, icon: pages.icon, updatedAt: pages.updatedAt })
    .from(pages)
    .where(and(isNull(pages.trashedAt), ne(pages.type, "entry")))
    .orderBy(desc(pages.updatedAt))
    .limit(limit);
}

// executor : la base vive par défaut, la copie d'une sauvegarde quand l'écran
// de sauvegarde lit (lib/backup_read.ts).
export async function getPage(id: string, executor: Pick<typeof db, "select"> = db): Promise<Page | null> {
  const [row] = await executor.select().from(pages).where(eq(pages.id, id)).limit(1);
  return row ?? null;
}

// Un parent doit exister, être hors corbeille et être une page : une base
// range ses entrées elle-même, une entrée n'a pas de sous-pages dans l'arbre.
async function checkParent(parentId: string): Promise<Outcome> {
  const parent = await getPage(parentId);
  if (!parent || parent.trashedAt) return { ok: false, status: 404, error: "Page parente introuvable" };
  if (parent.type !== "page") return { ok: false, status: 400, error: "Seule une page peut recevoir des sous-pages" };
  return { ok: true };
}

// Page vierge ou base vide, à la racine ou sous parentId.
export async function createPage(parentId: string | null, type: "page" | "database" = "page"): Promise<Outcome & { id?: string }> {
  if (parentId) {
    const check = await checkParent(parentId);
    if (!check.ok) return check;
  }
  const id = newId("pg");
  await db.insert(pages).values({ id, parentId, type, dbConfig: type === "database" ? emptyConfig() : null });
  return { ok: true, id };
}

export type PagePatch = {
  title?: string;
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number | null;
  body?: unknown[];
};

// Contrôle de version d'un enregistrement de l'éditeur (lib/web_save.ts) :
// la révision lue par le navigateur, et sa base pour fusionner si la ligne a
// bougé depuis.
export type SaveCheck = { baseRev: number; base?: WebFields };

export type SaveResult =
  | { ok: true; updatedAt: Date; rev: number; merged?: WebFields; conflicts: number }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string; rev: number };

// body_text suit toujours body : c'est lui que lit la recherche. Sans check
// (icône, bandeau, onglet ouvert avant ce contrôle), le champ envoyé s'écrit
// tel quel. Avec check, ligne verrouillée : révision inchangée, écriture
// directe ; changée sans base, 409 pour que le navigateur renvoie sa base ;
// changée avec base, fusion à trois versions de titre et corps.
export async function updatePage(id: string, patch: PagePatch, check?: SaveCheck): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ rev: pages.rev, title: pages.title, body: pages.body, updatedAt: pages.updatedAt })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.trashedAt)))
      .for("update");
    if (!row) return { ok: false, status: 404, error: "Page introuvable" } as const;

    let fields: PagePatch = patch;
    let merged: WebFields | undefined;
    let conflicts = 0;
    if (check && row.rev !== check.baseRev && (patch.title !== undefined || patch.body !== undefined)) {
      if (!check.base) return { ok: false, status: 409, error: "Page modifiée ailleurs", rev: row.rev } as const;
      const now = new Date().toISOString();
      const result = mergeWebSave(check.base, patch, { title: row.title, body: row.body, updatedAt: row.updatedAt.toISOString() }, now);
      fields = { ...patch, ...result.fields };
      merged = result.fields;
      conflicts = result.conflicts;
    }

    const values: Partial<typeof pages.$inferInsert> = {};
    if (fields.title !== undefined) values.title = fields.title;
    if (fields.icon !== undefined) values.icon = fields.icon;
    if (fields.cover !== undefined) values.cover = fields.cover;
    if (fields.coverPosition !== undefined) values.coverPosition = fields.coverPosition;
    if (fields.body !== undefined) {
      values.body = fields.body;
      values.bodyText = flattenToText(fields.body);
    }
    const [saved] = await tx.update(pages).set(values).where(eq(pages.id, id)).returning({ updatedAt: pages.updatedAt, rev: pages.rev });
    return { ok: true, updatedAt: saved.updatedAt, rev: saved.rev, merged, conflicts } as const;
  });
}

// Reparentage. newParentId null : la page remonte à la racine.
export async function movePage(id: string, newParentId: string | null): Promise<Outcome> {
  const page = await getPage(id);
  if (!page || page.trashedAt || page.type === "entry") return NOT_FOUND;
  if (newParentId) {
    const check = await checkParent(newParentId);
    if (!check.ok) return check;
  }
  const rows = await db.select({ id: pages.id, parentId: pages.parentId }).from(pages);
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  if (wouldCreateCycle(parentOf, id, newParentId)) {
    return { ok: false, status: 409, error: "Une page ne peut pas aller sous elle-même ni sous l'une de ses sous-pages" };
  }
  await db.update(pages).set({ parentId: newParentId }).where(eq(pages.id, id));
  return { ok: true };
}

// --- Corbeille -------------------------------------------------------------
//
// Supprimer une page y envoie tout son sous-arbre (sous-pages, et entrées si
// c'est une base), marqué d'un même trashed_at. Ce marqueur commun dit ce qui
// est parti ensemble : restaurer ou purger la page traite ce lot-là, et laisse
// en corbeille une sous-page supprimée plus tôt, à part.

// Ids du lot parti avec rootId (rootId compris). UNION, et non UNION ALL :
// arrête la récursion même si la base contenait une boucle. Lue aussi par
// media_cleanup_query.ts pour les médias d'une purge manuelle.
export function trashedBatch(rootId: string) {
  return sql`
    WITH RECURSIVE root AS (
      SELECT id, trashed_at FROM pages WHERE id = ${rootId} AND trashed_at IS NOT NULL
    ), batch AS (
      SELECT id FROM root
      UNION
      SELECT p.id FROM pages p JOIN batch b ON p.parent_id = b.id OR p.db_id = b.id
      WHERE p.trashed_at = (SELECT trashed_at FROM root)
    )
    SELECT id FROM batch`;
}

export async function trashPage(id: string): Promise<Outcome> {
  const result = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM pages WHERE id = ${id} AND trashed_at IS NULL
      UNION
      SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id OR p.db_id = s.id
      WHERE p.trashed_at IS NULL
    )
    UPDATE pages SET trashed_at = now(), updated_at = now() WHERE id IN (SELECT id FROM subtree)`);
  return result.rowCount ? { ok: true } : NOT_FOUND;
}

export type TrashItem = { id: string; title: string; icon: string | null; type: string; trashedAt: Date };

// Ne montre que la tête de chaque lot : une sous-page partie avec son parent
// se restaure avec lui.
export async function listTrash(): Promise<TrashItem[]> {
  const result = await db.execute<{ id: string; title: string; icon: string | null; type: string; trashed_at: Date }>(sql`
    SELECT p.id, p.title, p.icon, p.type, p.trashed_at
    FROM pages p
    LEFT JOIN pages parent ON parent.id = p.parent_id
    LEFT JOIN pages base ON base.id = p.db_id
    WHERE p.trashed_at IS NOT NULL
      AND (parent.id IS NULL OR parent.trashed_at IS DISTINCT FROM p.trashed_at)
      AND (base.id IS NULL OR base.trashed_at IS DISTINCT FROM p.trashed_at)
    ORDER BY p.trashed_at DESC`);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    type: row.type,
    trashedAt: new Date(row.trashed_at),
  }));
}

// Pages en corbeille, sous-pages et entrées comprises : le compte annoncé
// avant de vider la corbeille.
export async function countTrash(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(pages).where(isNotNull(pages.trashedAt));
  return row?.n ?? 0;
}

// Restaure le lot. Si le parent est resté en corbeille, la page remonte à la
// racine plutôt que de rester invisible (parent purgé : déjà null, par la FK).
// Une entrée ne vit que dans sa base : tant que la base est en corbeille,
// l'entrée y reste aussi.
export async function restorePage(id: string): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const [base] = await tx
      .select({ title: pages.title, trashedAt: pages.trashedAt })
      .from(pages)
      .where(sql`${pages.id} = (SELECT db_id FROM pages WHERE id = ${id} AND type = 'entry')`);
    if (base?.trashedAt) {
      return { ok: false, status: 409, error: `Restaurez d'abord sa base, « ${base.title || "Sans titre"} ».` } as const;
    }
    const restored = await tx.execute(sql`
      UPDATE pages SET trashed_at = NULL, updated_at = now() WHERE id IN (${trashedBatch(id)})`);
    if (!restored.rowCount) return NOT_FOUND;
    await tx.execute(sql`
      UPDATE pages p SET parent_id = NULL
      FROM pages parent
      WHERE p.id = ${id} AND parent.id = p.parent_id AND parent.trashed_at IS NOT NULL`);
    return { ok: true } as const;
  });
}

// Suppression définitive du lot, sans ses fichiers : purgeWithMedia
// (media_cleanup_query.ts) les efface aussitôt pour une purge manuelle, le
// balayage 30 jours après pour la purge automatique.
export async function purgePage(id: string): Promise<Outcome> {
  const result = await db.execute(sql`DELETE FROM pages WHERE id IN (${trashedBatch(id)})`);
  return result.rowCount ? { ok: true } : NOT_FOUND;
}

// Purge des éléments en corbeille depuis plus de 30 jours. Un lot partage son
// trashed_at, il part donc toujours en entier.
export async function purgeExpired(): Promise<number> {
  const limit = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(pages).where(lt(pages.trashedAt, limit)).returning({ id: pages.id });
  return deleted.length;
}

// --- Médias ----------------------------------------------------------------

export async function recordMedia(values: typeof media.$inferInsert): Promise<void> {
  await db.insert(media).values(values);
}

export async function getMedia(filename: string) {
  const [row] = await db.select().from(media).where(eq(media.filename, filename)).limit(1);
  return row ?? null;
}
