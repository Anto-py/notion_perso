// Accès aux pages : arbre, création, modification, déplacement, corbeille.
// Ce module ne décide d'aucun droit : chaque appelant passe d'abord par
// canAccess (lib/access.ts), point unique des décisions d'accès.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, pages } from "@/db/schema";
import { FOLDER_ICON, fallbackParent, placementError, trashError, type PageKind } from "./bases";
import { appendAtEnd, flattenToText, ownerRefs, subpageOwnerBlock, withoutOwnerBlocks } from "./blocks";
import { newId } from "./ids";
import { removeCitedEntries } from "./relation_query";
import { emptyConfig } from "./views";
import { orderBefore, wouldCreateCycle, type AbsentTarget, type TreeRow } from "./tree";
import { mergeWebSave, type WebFields } from "./web_save";

export const TRASH_RETENTION_DAYS = 30;

export type Page = typeof pages.$inferSelect;

export type Outcome = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

const NOT_FOUND: Outcome = { ok: false, status: 404, error: "Page introuvable" };

// La racine des bases : la ligne `is_bases_root`, jamais un id fixe (étape 17).
// Elle a un parent (« Ressources »), donc elle ne peut pas servir de repli
// implicite : chaque appelant qui range une base ou un dossier la lit ici.
export async function basesRootId(executor: Pick<typeof db, "select"> = db): Promise<string | null> {
  const [row] = await executor
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.isBasesRoot, true), isNull(pages.trashedAt)))
    .limit(1);
  return row?.id ?? null;
}

// Pages, bases et dossiers, hors corbeille. Les entrées de base vivent dans
// leur base, pas dans la sidebar. Le Vide-cerveau y figure comme toute base,
// sous « Bases de données », en plus de son épingle (étape 16).
export async function listTreeRows(): Promise<TreeRow[]> {
  const rows = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      type: pages.type,
      title: pages.title,
      icon: pages.icon,
      closed: pages.shareClosed,
      basesRoot: pages.isBasesRoot,
      inbox: pages.isInbox,
      rootException: pages.rootException,
      manualOrder: pages.manualOrder,
    })
    .from(pages)
    .where(and(isNull(pages.trashedAt), ne(pages.type, "entry")))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    icon: row.icon,
    closed: row.closed,
    basesRoot: row.basesRoot,
    inbox: row.inbox,
    rootException: row.rootException,
  }));
}

// Cibles de blocs-liens absentes de l'arbre, en une requête : une page vivante
// hors sidebar (entrée de base, Vide-cerveau) se rend encore en lien ; les
// autres sont en corbeille, ou purgées quand la ligne n'existe plus.
export async function linkTargets(ids: readonly string[]): Promise<{ rows: TreeRow[]; absent: Record<string, AbsentTarget> }> {
  const absent: Record<string, AbsentTarget> = {};
  if (!ids.length) return { rows: [], absent };
  const found = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      type: pages.type,
      title: pages.title,
      icon: pages.icon,
      closed: pages.shareClosed,
      trashedAt: pages.trashedAt,
    })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  const rows: TreeRow[] = [];
  for (const { trashedAt, ...row } of found) {
    if (trashedAt) absent[row.id] = "trashed";
    else rows.push(row);
  }
  for (const id of ids) {
    if (!found.some((row) => row.id === id)) absent[id] = "deleted";
  }
  return { rows, absent };
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

// Un parent doit exister et être hors corbeille, puis accepter l'élément
// (lib/bases.ts) : une page sous une page (racine comprise) ou à la racine de
// l'arbre, une base ou un dossier sous la racine des bases ou un de ses
// dossiers.
async function checkParent(
  child: { type: PageKind; isBasesRoot?: boolean },
  parentId: string | null,
  executor: Pick<typeof db, "select"> = db,
): Promise<Outcome> {
  let parent: Page | null = null;
  if (parentId) {
    parent = await getPage(parentId, executor);
    if (!parent || parent.trashedAt) return { ok: false, status: 404, error: "Page parente introuvable" };
  }
  const error = placementError(child, parent);
  return error ? { ok: false, status: 400, error } : { ok: true };
}

export type CreatedKind = "page" | "database" | "folder";

// Page vierge, base vide ou dossier. Sans parentId, une page naît à la racine
// de l'arbre, une base ou un dossier sous la racine des bases. init : titre et
// corps d'une page créée par l'agent, écrits dans la même insertion. tx : la
// transaction d'un appelant qui écrit d'autres lignes avec cette page (bloc
// envoyé à la racine, lib/block_move_query.ts) ; tout se lit alors par elle.
export async function createPage(
  parentId: string | null,
  type: CreatedKind = "page",
  init: { title?: string; body?: unknown[] } = {},
  tx?: Tx,
): Promise<Outcome & { id?: string }> {
  const q = tx ?? db;
  const parent = parentId ?? fallbackParent({ type }, await basesRootId(q));
  const check = await checkParent({ type }, parent, q);
  if (!check.ok) return check;
  const id = newId("pg");
  await q.insert(pages).values({
    id,
    parentId: parent,
    type,
    icon: type === "folder" ? FOLDER_ICON : null,
    dbConfig: type === "database" ? emptyConfig() : null,
    ...(init.title !== undefined ? { title: init.title } : {}),
    ...(init.body !== undefined ? { body: init.body, bodyText: flattenToText(init.body) } : {}),
  });
  return { ok: true, id };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Ajout en bas d'un corps, sous verrou de ligne : deux ajouts simultanés ne se
// perdent pas, et l'éditeur resté ouvert, dont la révision est dépassée,
// fusionne par bloc à son prochain enregistrement (lib/web_save.ts). Jamais de
// remplacement. tx : la transaction d'un appelant qui crée la page avant d'y
// écrire (entrée de base, palier d).
export async function appendBlocks(pageId: string, blocks: readonly unknown[], tx?: Tx): Promise<Outcome> {
  const run = async (t: Tx): Promise<Outcome> => {
    const [row] = await t
      .select({ type: pages.type, body: pages.body, trashedAt: pages.trashedAt })
      .from(pages)
      .where(eq(pages.id, pageId))
      .for("update");
    if (!row) return NOT_FOUND;
    if (row.trashedAt) return { ok: false, status: 409, error: "Page en corbeille : restaurez-la d'abord." };
    if (row.type === "folder" || row.type === "database") {
      return { ok: false, status: 400, error: "Un dossier ou une base n'a pas de corps où ajouter." };
    }
    const next = appendAtEnd(row.body, blocks);
    await t.update(pages).set({ body: next, bodyText: flattenToText(next) }).where(eq(pages.id, pageId));
    return { ok: true };
  };
  return tx ? run(tx) : db.transaction(run);
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

// Reparentage. newParentId null : la page remonte à la racine de l'arbre ;
// une base ou un dossier ne quitte jamais « Bases ». beforeId (facultatif)
// insère la page devant cette sœur, null la met en fin de liste ; absent, la
// page garde sa clé d'ordre et se range selon elle. placeBlock faux : le bloc
// posant lui-même (page déposée à un endroit précis de l'éditeur ouvert).
// leaveBlock vrai : le bloc propriétaire reste aussi dans l'ancienne mère, dont
// l'éditeur ouvert le retire lui-même (menu de bloc, lib/block_move_query.ts) ;
// le serveur n'écrit alors pas son corps. tx : la transaction d'un appelant,
// où tout se lit et s'écrit (lignes créées plus tôt dans la même transaction).
export async function movePage(
  id: string,
  newParentId: string | null,
  beforeId?: string | null,
  { placeBlock = true, leaveBlock = false, tx }: { placeBlock?: boolean; leaveBlock?: boolean; tx?: Tx } = {},
): Promise<Outcome> {
  const q = tx ?? db;
  const page = await getPage(id, q);
  if (!page || page.trashedAt || page.type === "entry") return NOT_FOUND;
  // La racine des bases reste sous « Ressources » : elle porte le rangement de
  // toutes les bases, la déplacer le rendrait invisible de sa page d'accueil.
  if (page.isBasesRoot) return { ok: false, status: 400, error: "« Bases de données » reste sous « Ressources »." };
  const check = await checkParent(page, newParentId, q);
  if (!check.ok) return check;
  const rows = await q.select({ id: pages.id, parentId: pages.parentId }).from(pages);
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  if (wouldCreateCycle(parentOf, id, newParentId)) {
    return { ok: false, status: 409, error: "Une page ne peut pas aller sous elle-même ni sous l'une de ses sous-pages" };
  }
  const set: { parentId: string | null; manualOrder?: string } = { parentId: newParentId };
  if (beforeId !== undefined) {
    const siblings = await q
      .select({ id: pages.id, manualOrder: pages.manualOrder })
      .from(pages)
      .where(
        and(
          newParentId ? eq(pages.parentId, newParentId) : isNull(pages.parentId),
          isNull(pages.trashedAt),
          ne(pages.type, "entry"),
          ne(pages.id, id),
        ),
      )
      .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
    if (beforeId && !siblings.some((row) => row.id === beforeId)) {
      return { ok: false, status: 409, error: "Ligne de référence introuvable" };
    }
    set.manualOrder = orderBefore(siblings, beforeId);
  }
  const write = async (t: Tx) => {
    await t.update(pages).set(set).where(eq(pages.id, id));
    if (page.type === "page" && page.parentId !== newParentId) {
      await carryOwnerBlock(t, id, leaveBlock ? null : page.parentId, placeBlock ? newParentId : null);
    }
  };
  if (tx) await write(tx);
  else await db.transaction(write);
  return { ok: true };
}

// Le bloc propriétaire suit la sous-page (lib/blocks.ts, withoutOwnerBlocks) :
// retiré du corps de l'ancienne mère, ajouté au bas de la nouvelle si elle a un
// corps et ne le porte pas déjà. Lignes verrouillées : un ajout du Vide-cerveau
// ou d'un agent au même instant ne se perd pas, et l'éditeur ouvert, dont la
// révision est dépassée, fusionne à son prochain enregistrement.
async function carryOwnerBlock(tx: Tx, id: string, oldParentId: string | null, newParentId: string | null) {
  const bodyOf = async (pageId: string) => {
    const [row] = await tx.select({ type: pages.type, body: pages.body }).from(pages).where(eq(pages.id, pageId)).for("update");
    return row;
  };
  const write = (pageId: string, body: unknown[]) =>
    tx.update(pages).set({ body, bodyText: flattenToText(body) }).where(eq(pages.id, pageId));

  if (oldParentId) {
    const row = await bodyOf(oldParentId);
    if (row) {
      const { body, removed } = withoutOwnerBlocks(row.body, id);
      if (removed) await write(oldParentId, body);
    }
  }
  if (newParentId) {
    const row = await bodyOf(newParentId);
    if (row && row.type === "page" && !ownerRefs(row.body).has(id)) {
      await write(newParentId, appendAtEnd(row.body, [subpageOwnerBlock(id, globalThis.crypto.randomUUID())]));
    }
  }
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
  const page = await getPage(id);
  if (!page || page.trashedAt) return NOT_FOUND;
  const refused = trashError(page);
  if (refused) return { ok: false, status: 400, error: refused };
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

// Restaure le lot. Si le parent est resté en corbeille, purgé (déjà null, par
// la FK) ou refuse l'élément (lib/bases.ts), la page remonte à la racine de
// l'arbre, une base ou un dossier à celle de « Bases », plutôt que de rester
// invisible. Une entrée ne vit que dans sa base : tant que la base est en
// corbeille, l'entrée y reste aussi.
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
    const [head] = await tx
      .select({ type: pages.type, parentId: pages.parentId, isBasesRoot: pages.isBasesRoot, rootException: pages.rootException })
      .from(pages)
      .where(eq(pages.id, id));
    if (head && head.type !== "entry") {
      const [parent] = head.parentId
        ? await tx.select({ type: pages.type, isBasesRoot: pages.isBasesRoot, trashedAt: pages.trashedAt }).from(pages).where(eq(pages.id, head.parentId))
        : [];
      const livable = parent && !parent.trashedAt ? parent : null;
      if ((head.parentId && !livable) || placementError(head, livable)) {
        await tx.update(pages).set({ parentId: fallbackParent(head, await basesRootId(tx)) }).where(eq(pages.id, id));
      }
    }
    return { ok: true } as const;
  });
}

// Suppression définitive du lot, sans ses fichiers : purgeWithMedia
// (media_cleanup_query.ts) les efface aussitôt pour une purge manuelle, le
// balayage 30 jours après pour la purge automatique.
export async function purgePage(id: string): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const batch = await tx.execute<{ id: string }>(sql`SELECT id FROM (${trashedBatch(id)}) AS lot`);
    const ids = batch.rows.map((row) => row.id);
    if (ids.length === 0) return NOT_FOUND;
    // Les relations qui citaient ces entrées perdent leurs ids morts avant que
    // les lignes ne disparaissent (étape 10, palier d).
    await removeCitedEntries(tx, ids);
    await tx.execute(sql`DELETE FROM pages WHERE id IN (${trashedBatch(id)})`);
    return { ok: true } as const;
  });
}

// Purge des éléments en corbeille depuis plus de 30 jours. Un lot partage son
// trashed_at, il part donc toujours en entier. Les relations qui citaient les
// entrées purgées sont nettoyées dans la même transaction.
export async function purgeExpired(): Promise<number> {
  return db.transaction(async (tx) => {
    const limit = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await tx.select({ id: pages.id }).from(pages).where(lt(pages.trashedAt, limit));
    if (expired.length === 0) return 0;
    await removeCitedEntries(tx, expired.map((row) => row.id));
    await tx.delete(pages).where(lt(pages.trashedAt, limit));
    return expired.length;
  });
}

// --- Médias ----------------------------------------------------------------

export async function recordMedia(values: typeof media.$inferInsert): Promise<void> {
  await db.insert(media).values(values);
}

export async function getMedia(filename: string) {
  const [row] = await db.select().from(media).where(eq(media.filename, filename)).limit(1);
  return row ?? null;
}

// --- Dossiers de « Bases » ---------------------------------------------------

export type FolderItem = { id: string; type: "database" | "folder"; title: string; icon: string | null; entries: number; inbox: boolean };

// Contenu d'un dossier, dossiers d'abord puis bases, dans l'ordre de la barre
// latérale ; le nombre d'entrées vivantes de chaque base en une requête groupée.
export async function listFolder(folderId: string): Promise<FolderItem[]> {
  const result = await db.execute<{ id: string; type: "database" | "folder"; title: string; icon: string | null; entries: number; is_inbox: boolean }>(sql`
    SELECT p.id, p.type, p.title, p.icon, p.is_inbox, coalesce(n.entries, 0)::int AS entries
    FROM pages p
    LEFT JOIN (
      SELECT db_id, count(*) AS entries FROM pages
      WHERE type = 'entry' AND trashed_at IS NULL AND db_id IS NOT NULL
      GROUP BY db_id
    ) n ON n.db_id = p.id
    WHERE p.parent_id = ${folderId} AND p.trashed_at IS NULL AND p.type IN ('folder', 'database')
    ORDER BY (p.type = 'folder') DESC, p.manual_order, p.created_at`);
  return result.rows.map((row) => ({ id: row.id, type: row.type, title: row.title, icon: row.icon, entries: Number(row.entries), inbox: row.is_inbox }));
}

// Ce qu'emporte un dossier mis à la corbeille : ses bases, à toute profondeur.
export async function countFolderBases(folderId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM pages WHERE id = ${folderId} AND trashed_at IS NULL
      UNION
      SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
      WHERE p.trashed_at IS NULL AND p.type IN ('folder', 'database')
    )
    SELECT count(*)::int AS n FROM pages WHERE id IN (SELECT id FROM subtree) AND type = 'database'`);
  return Number(result.rows[0]?.n ?? 0);
}

// Pages hors corbeille qui montrent la base par une vue liée : la confirmation
// de corbeille les nomme, leurs vues afficheront « Base introuvable ».
export async function linkedHosts(dbId: string): Promise<{ id: string; title: string }[]> {
  const result = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages
    WHERE trashed_at IS NULL
      AND jsonb_path_exists(body, '$.** ? (@.type == "linked" && @.props.databaseId == $id)', jsonb_build_object('id', ${dbId}::text))
    ORDER BY title`);
  return result.rows;
}
