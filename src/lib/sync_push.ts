// Application d'un envoi de l'app Mac (POST /api/sync/push, SPECS.md,
// « Synchronisation avec l'app Mac ») : une transaction qui verrouille les
// lignes visées, prend la décision de sync_protocol.ts pour chacune, écrit, puis
// relit l'état final. Accès et lecture du flux : sync_server.ts.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { deletions, iconImages, media, pages } from "@/db/schema";
import { flattenToText } from "./blocks";
import { deleteMediaIfUnused } from "./media_cleanup_query";
import { migrateValues, normalizeValues, valuesToText, type Property } from "./properties";
import { fileSize } from "./storage";
import type { SyncPage } from "./sync_merge";
import {
  decideDeletion,
  decideIconImage,
  decidePage,
  iconImageToSync,
  mediaToSync,
  pageToSync,
  writeOrder,
  type PushItem,
  type SyncIconImage,
  type SyncKind,
  type SyncMedia,
} from "./sync_protocol";
import { parseConfig } from "./views";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

// Pour chaque ligne envoyée, l'état du serveur après coup : la ligne et sa
// révision, sa suppression, ou le refus de cette ligne seule.
export type PushOutcome =
  | { kind: "page"; id: string; rev: number; row: SyncPage; conflicts: number; revived: boolean }
  | { kind: "media"; id: string; rev: number; row: SyncMedia }
  | { kind: "icon_image"; id: string; rev: number; row: SyncIconImage }
  | { kind: SyncKind; id: string; deleted: true }
  | { kind: SyncKind; id: string; error: string };

type Upsert<K extends SyncKind> = Extract<PushItem, { kind: K; row: unknown }>;
type Deletion = Extract<PushItem, { deleted: true }>;
type Notes = Map<string, { conflicts: number; revived: boolean }>;

const isDeletion = (item: PushItem): item is Deletion => "deleted" in item;
const upserts = <K extends SyncKind>(items: PushItem[], kind: K) =>
  items.filter((item): item is Upsert<K> => item.kind === kind && !isDeletion(item));
const deletionsOf = (items: PushItem[], kind: SyncKind) => items.filter((item): item is Deletion => item.kind === kind && isDeletion(item));

export async function applyPush(items: PushItem[]): Promise<PushOutcome[]> {
  const now = new Date().toISOString();
  const notes: Notes = new Map();
  const errors = new Map<string, string>();

  await db.transaction(async (tx) => {
    await upsertPages(tx, upserts(items, "page"), now, notes);
    await insertMedia(tx, upserts(items, "media"), errors);
    await upsertIconImages(tx, upserts(items, "icon_image"), errors);
    await deletePages(tx, deletionsOf(items, "page"));
    await deleteIconImages(tx, deletionsOf(items, "icon_image"));
  });

  // Hors transaction, après les pages : un média n'est effacé que si plus
  // rien ne le cite, fichier compris ; sinon le Mac le reprend.
  for (const item of deletionsOf(items, "media")) {
    try {
      await deleteMediaIfUnused(item.id);
    } catch (error) {
      console.error(`Synchronisation : média ${item.id} non effacé :`, error);
    }
  }

  return currentState(items, notes, errors);
}

// Une page envoyée par le Mac, après décision. Un parent purgé entre-temps la
// renvoie à la racine, comme ON DELETE SET NULL ; une entrée dont la base a
// été purgée n'a plus où vivre : elle devient une page, en corbeille, sans ses
// valeurs. Les champs dérivés sont recalculés ici, jamais reçus.
async function writePage(tx: Tx, input: SyncPage, previous: typeof pages.$inferSelect | undefined, now: string) {
  let row = input;
  const refs = [row.parentId, row.dbId].filter((ref): ref is string => ref !== null);
  const targets = refs.length
    ? await tx.select({ id: pages.id, type: pages.type, dbConfig: pages.dbConfig }).from(pages).where(inArray(pages.id, refs))
    : [];
  const byId = new Map(targets.map((target) => [target.id, target]));
  if (row.parentId && !byId.has(row.parentId)) row = { ...row, parentId: null };
  const database = row.dbId ? byId.get(row.dbId) : undefined;
  if (row.type === "entry" && database?.type !== "database") {
    row = { ...row, type: "page", dbId: null, propertyValues: null, inboxKind: null, trashedAt: row.trashedAt ?? now };
  }

  // Un seul Vide-cerveau (index unique) : celui du serveur garde le rôle.
  if (row.isInbox) {
    const [other] = await tx.select({ id: pages.id }).from(pages).where(and(eq(pages.isInbox, true), ne(pages.id, row.id)));
    if (other) row = { ...row, isInbox: false };
  }
  if (row.publicId) {
    const [other] = await tx.select({ id: pages.id }).from(pages).where(and(eq(pages.publicId, row.publicId), ne(pages.id, row.id)));
    if (other) row = { ...row, publicId: null, shareEnabled: false };
  }

  let dbConfig = null;
  let propertyValues = null;
  let valuesText = "";
  if (row.type === "database") dbConfig = parseConfig(row.dbConfig);
  if (row.type === "entry") {
    const properties = parseConfig(database!.dbConfig).properties;
    propertyValues = normalizeValues(properties, row.propertyValues);
    valuesText = valuesToText(properties, propertyValues);
  }

  const values = {
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    coverPosition: row.coverPosition,
    body: row.body,
    bodyText: flattenToText(row.body),
    dbConfig,
    dbId: row.dbId,
    propertyValues,
    valuesText,
    inboxKind: row.inboxKind,
    isInbox: row.isInbox,
    manualOrder: row.manualOrder,
    shareEnabled: row.shareEnabled,
    publicId: row.publicId,
    shareIncludeSubpages: row.shareIncludeSubpages,
    createdAt: new Date(row.createdAt),
    // Explicite : sans lui, $onUpdate de Drizzle mettrait l'heure du serveur,
    // et la fusion suivante ne saurait plus quelle version est la plus récente.
    updatedAt: new Date(row.updatedAt),
    trashedAt: row.trashedAt ? new Date(row.trashedAt) : null,
  };
  await tx.insert(pages).values({ id: row.id, ...values }).onConflictDoUpdate({ target: pages.id, set: values });

  if (dbConfig && previous?.type === "database") {
    await migrateEntries(tx, row.id, parseConfig(previous.dbConfig).properties, dbConfig.properties);
  }
}

// Une base dont les propriétés ont changé : ses entrées suivent le nouveau
// schéma, comme dans updateDatabase (lib/databases.ts).
async function migrateEntries(tx: Tx, dbId: string, before: Property[], after: Property[]) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const entries = await tx.select({ id: pages.id, propertyValues: pages.propertyValues }).from(pages).where(eq(pages.dbId, dbId));
  for (const entry of entries) {
    const values = migrateValues(before, after, normalizeValues(before, entry.propertyValues));
    await tx
      .update(pages)
      .set({ propertyValues: values, valuesText: valuesToText(after, values), updatedAt: sql`${pages.updatedAt}` })
      .where(eq(pages.id, entry.id));
  }
}

async function upsertPages(tx: Tx, items: Upsert<"page">[], now: string, notes: Notes) {
  if (!items.length) return;
  const ids = items.map((item) => item.id);
  const current = await tx.select().from(pages).where(inArray(pages.id, ids)).orderBy(pages.id).for("update");
  const before = new Map(current.map((row) => [row.id, row]));
  const purged = new Set(
    (await tx.select({ id: deletions.id }).from(deletions).where(and(eq(deletions.kind, "page"), inArray(deletions.id, ids)))).map(
      (row) => row.id,
    ),
  );

  const rows: SyncPage[] = [];
  for (const item of items) {
    const server = before.get(item.id);
    const decision = decidePage(item, server ? { rev: server.rev, row: pageToSync(server) } : null, purged.has(item.id), now);
    notes.set(item.id, { conflicts: decision.conflicts, revived: decision.revived });
    rows.push(decision.row);
  }
  for (const row of writeOrder(rows)) await writePage(tx, row, before.get(row.id), now);

  const revived = [...notes].filter(([, note]) => note.revived).map(([id]) => id);
  if (revived.length) await tx.delete(deletions).where(and(eq(deletions.kind, "page"), inArray(deletions.id, revived)));
  await breakCycles(tx, ids);
}

// Page A rangée sous B d'un côté, B sous A de l'autre : chaque déplacement
// était sain, leur réunion boucle. La plus récemment modifiée remonte à la
// racine, jusqu'à ce qu'aucune boucle ne reste. UNION (et non UNION ALL)
// arrête la remontée sur une boucle qui ne passe pas par la page de départ.
async function breakCycles(tx: Tx, ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    const looped = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE up(start, id) AS (
        SELECT p.id, p.parent_id FROM pages p WHERE p.id IN (${list(ids)}) AND p.parent_id IS NOT NULL
        UNION
        SELECT up.start, p.parent_id FROM up JOIN pages p ON p.id = up.id
        WHERE p.parent_id IS NOT NULL AND up.id <> up.start)
      SELECT p.id FROM up JOIN pages p ON p.id = up.start
      WHERE up.id = up.start ORDER BY p.updated_at DESC LIMIT 1`);
    const id = looped.rows[0]?.id;
    if (!id) return;
    await tx.update(pages).set({ parentId: null, updatedAt: sql`${pages.updatedAt}` }).where(eq(pages.id, id));
  }
}

// Un média ne change jamais : seul un média inconnu s'ajoute, et seulement
// une fois son fichier arrivé (PUT /api/sync/media/[file]) et de la bonne taille.
async function insertMedia(tx: Tx, items: Upsert<"media">[], errors: Map<string, string>) {
  if (!items.length) return;
  const known = new Set(
    (await tx.select({ id: media.id }).from(media).where(inArray(media.id, items.map((item) => item.id)))).map((row) => row.id),
  );
  for (const { id, row } of items) {
    if (known.has(id)) continue;
    const size = await fileSize(row.filename);
    if (size === null) {
      errors.set(`media:${id}`, "Fichier absent du serveur : l'envoyer d'abord");
      continue;
    }
    if (size !== row.size) {
      errors.set(`media:${id}`, `Fichier incomplet sur le serveur (${size} octets sur ${row.size})`);
      continue;
    }
    const [page] = row.pageId ? await tx.select({ id: pages.id }).from(pages).where(eq(pages.id, row.pageId)) : [];
    await tx.insert(media).values({
      id,
      filename: row.filename,
      originalName: row.originalName,
      mime: row.mime,
      size: row.size,
      pageId: page ? row.pageId : null,
      createdAt: new Date(row.createdAt),
    });
  }
}

async function upsertIconImages(tx: Tx, items: Upsert<"icon_image">[], errors: Map<string, string>) {
  if (!items.length) return;
  const current = await tx
    .select()
    .from(iconImages)
    .where(inArray(iconImages.id, items.map((item) => item.id)))
    .orderBy(iconImages.id)
    .for("update");
  const before = new Map(current.map((row) => [row.id, row]));
  for (const item of items) {
    const server = before.get(item.id);
    const row = decideIconImage(item, server ? { rev: server.rev, row: iconImageToSync(server) } : null);
    const [file] = await tx.select({ id: media.id }).from(media).where(eq(media.id, row.mediaId));
    if (!file) {
      errors.set(`icon_image:${item.id}`, "Média de l'icône absent du serveur : l'envoyer d'abord");
      continue;
    }
    const values = { mediaId: row.mediaId, name: row.name, hidden: row.hidden, createdAt: new Date(row.createdAt) };
    await tx.insert(iconImages).values({ id: row.id, ...values }).onConflictDoUpdate({ target: iconImages.id, set: values });
  }
}

// Une page purgée sur le Mac. Inchangée sur le serveur depuis la base du
// Mac : effacée. Modifiée entre-temps : elle reste, en corbeille. Une base
// n'est effacée que si toutes ses entrées le sont aussi, sinon la cascade
// emporterait une entrée gardée ou créée ailleurs : elle reste en corbeille.
async function deletePages(tx: Tx, items: Deletion[]) {
  if (!items.length) return;
  const ids = items.map((item) => item.id);
  const current = await tx
    .select({ id: pages.id, rev: pages.rev, type: pages.type })
    .from(pages)
    .where(inArray(pages.id, ids))
    .orderBy(pages.id)
    .for("update");
  const byId = new Map(current.map((row) => [row.id, row]));
  const toDelete = new Set<string>();
  const toTrash: string[] = [];
  for (const item of items) {
    const decision = decideDeletion(item.baseRev, byId.get(item.id) ?? null);
    if (decision === "delete") toDelete.add(item.id);
    if (decision === "trash") toTrash.push(item.id);
  }

  const databases = [...toDelete].filter((id) => byId.get(id)?.type === "database");
  if (databases.length) {
    const kept = await tx
      .selectDistinct({ dbId: pages.dbId })
      .from(pages)
      .where(sql`${pages.dbId} IN (${list(databases)}) AND ${pages.id} NOT IN (${list([...toDelete])})`);
    for (const { dbId } of kept) {
      toDelete.delete(dbId!);
      toTrash.push(dbId!);
    }
  }

  if (toTrash.length) {
    await tx
      .update(pages)
      .set({ trashedAt: sql`coalesce(${pages.trashedAt}, now())`, updatedAt: sql`${pages.updatedAt}` })
      .where(inArray(pages.id, toTrash));
  }
  if (toDelete.size) await tx.delete(pages).where(inArray(pages.id, [...toDelete]));
}

// Une image retirée de la bibliothèque sur le Mac, effacée seulement si le
// serveur ne l'a pas changée depuis ; sinon elle reste, et le Mac la reprend.
async function deleteIconImages(tx: Tx, items: Deletion[]) {
  for (const item of items) {
    const [server] = await tx.select({ rev: iconImages.rev }).from(iconImages).where(eq(iconImages.id, item.id)).for("update");
    if (decideDeletion(item.baseRev, server ?? null) === "delete") await tx.delete(iconImages).where(eq(iconImages.id, item.id));
  }
}

// L'état final de chaque ligne envoyée, relu après coup : il porte aussi les
// effets de bord (parent remonté à la racine, entrée sans base, Vide-cerveau
// en double), que le Mac reprend tels quels.
async function currentState(items: PushItem[], notes: Notes, errors: Map<string, string>): Promise<PushOutcome[]> {
  const idsOf = (kind: SyncKind) => items.filter((item) => item.kind === kind).map((item) => item.id);
  const [pageIds, mediaIds, iconIds] = [idsOf("page"), idsOf("media"), idsOf("icon_image")];
  const found = new Map<string, PushOutcome>();
  for (const row of pageIds.length ? await db.select().from(pages).where(inArray(pages.id, pageIds)) : []) {
    const note = notes.get(row.id) ?? { conflicts: 0, revived: false };
    found.set(`page:${row.id}`, { kind: "page", id: row.id, rev: row.rev, row: pageToSync(row), ...note });
  }
  for (const row of mediaIds.length ? await db.select().from(media).where(inArray(media.id, mediaIds)) : []) {
    found.set(`media:${row.id}`, { kind: "media", id: row.id, rev: row.rev, row: mediaToSync(row) });
  }
  for (const row of iconIds.length ? await db.select().from(iconImages).where(inArray(iconImages.id, iconIds)) : []) {
    found.set(`icon_image:${row.id}`, { kind: "icon_image", id: row.id, rev: row.rev, row: iconImageToSync(row) });
  }
  return items.map((item) => {
    const key = `${item.kind}:${item.id}`;
    const error = errors.get(key);
    if (error) return { kind: item.kind, id: item.id, error };
    return found.get(key) ?? { kind: item.kind, id: item.id, deleted: true };
  });
}
