// Lecture de la base d'une sauvegarde ouverte (palier d de l'étape 12) :
// arbre, page, fil d'Ariane, entrées et recherche. Le rendu est celui de la
// vue publique ; ce module lui donne les mêmes formes, lues sur la copie et
// jamais sur la base vive.
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { media, pages } from "@/db/schema";
import { backupDb } from "./backup_db";
import { listEntries } from "./databases";
import { getPage, type Page } from "./pages";
import type { SearchHit } from "./search";
import { searchPages } from "./search_query";
import type { TreeRow } from "./tree";

export type BackupChild = { id: string; type: Page["type"]; title: string; icon: string | null };
export type BackupCrumb = { id: string; title: string; icon: string | null };

// La base de la sauvegarde ouverte, null s'il n'y en a pas.
export function backupSource() {
  return backupDb();
}

// Même règle que l'arbre de la base vive : hors corbeille, sans entrées, sans
// le Vide-cerveau.
export async function backupTree(): Promise<TreeRow[]> {
  const db = backupDb();
  if (!db) return [];
  return db
    .select({ id: pages.id, parentId: pages.parentId, type: pages.type, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(isNull(pages.trashedAt), ne(pages.type, "entry"), eq(pages.isInbox, false)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

export async function backupPage(id: string): Promise<Page | null> {
  const db = backupDb();
  return db ? getPage(id, db) : null;
}

// La page et son sous-arbre, hors corbeille de la sauvegarde : sous-pages par
// parent_id, entrées par db_id. UNION arrête une éventuelle boucle.
export async function backupSubtree(id: string): Promise<Page[]> {
  const db = backupDb();
  if (!db) return [];
  const found = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM pages WHERE id = ${id} AND trashed_at IS NULL
      UNION
      SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id OR p.db_id = s.id
      WHERE p.trashed_at IS NULL
    )
    SELECT id FROM subtree`);
  const ids = found.rows.map((row) => row.id);
  if (!ids.length) return [];
  return db.select().from(pages).where(inArray(pages.id, ids));
}

export async function backupChildren(pageId: string): Promise<BackupChild[]> {
  const db = backupDb();
  if (!db) return [];
  return db
    .select({ id: pages.id, type: pages.type, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.parentId, pageId), isNull(pages.trashedAt), ne(pages.type, "entry"), eq(pages.isInbox, false)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

export async function backupEntries(dbId: string) {
  const db = backupDb();
  return db ? listEntries(dbId, db) : [];
}

// Ancêtres de la page, la plus lointaine d'abord, racine comprise : une
// entrée remonte par sa base, une page par son parent. La boucle s'arrête
// sur un id déjà vu, pour qu'une donnée abîmée ne fasse pas tourner sans fin.
export async function backupCrumbs(id: string): Promise<BackupCrumb[]> {
  const db = backupDb();
  if (!db) return [];
  const crumbs: BackupCrumb[] = [];
  const seen = new Set<string>([id]);
  const current = await getPage(id, db);
  let parentId = current ? (current.type === "entry" ? current.dbId : current.parentId) : null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await getPage(parentId, db);
    if (!parent) break;
    crumbs.unshift({ id: parent.id, title: parent.title, icon: parent.icon });
    parentId = parent.parentId;
  }
  return crumbs;
}

// Type MIME et nom d'origine d'un média, tels que la sauvegarde les a connus :
// le fichier lui-même n'est pas dans le dump, seule la ligne l'est.
export async function backupMedia(filename: string): Promise<{ mime: string; originalName: string } | null> {
  const db = backupDb();
  if (!db) return null;
  const [row] = await db
    .select({ mime: media.mime, originalName: media.originalName })
    .from(media)
    .where(eq(media.filename, filename))
    .limit(1);
  return row ?? null;
}

export async function backupSearch(query: string): Promise<SearchHit[]> {
  const db = backupDb();
  return db ? searchPages(query, db) : [];
}
