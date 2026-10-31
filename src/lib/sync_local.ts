// Synchronisation côté Mac, lectures et écritures de la base locale : ce qui
// attend d'être envoyé (par empreinte, contre sync_base), et l'application en
// une transaction de tout ce que le cycle a reçu. Décisions dans
// sync_client_plan.ts (pur), cycle et réseau dans sync_client.ts.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { iconImages, media, pages, syncBase, syncState } from "@/db/schema";
import { flattenToText } from "./blocks";
import { normalizeValues, valuesToText, type Property } from "./properties";
import {
  applyOrder,
  decideIncoming,
  isPending,
  localPage,
  rowHash,
  rowKey,
  type BaseEntry,
  type Candidate,
  type RowKey,
  type SyncRow,
} from "./sync_client_plan";
import type { SyncPage } from "./sync_merge";
import {
  iconImageToSync,
  mediaToSync,
  pageToSync,
  SYNC_KINDS,
  type Change,
  type SyncIconImage,
  type SyncKind,
  type SyncMedia,
} from "./sync_protocol";
import { parseConfig } from "./views";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Local = { id: string; localRev: number; row: SyncRow };

const TABLES = { page: pages, media, icon_image: iconImages } as const;

// Lignes locales d'un type, au format d'échange. lock : verrouillées jusqu'à
// la fin de la transaction, pour qu'aucun enregistrement ne s'intercale entre
// la décision et l'écriture.
async function readLocal(tx: Tx | typeof db, kind: SyncKind, ids: string[], lock = false): Promise<Local[]> {
  if (!ids.length) return [];
  if (kind === "page") {
    const query = tx.select().from(pages).where(inArray(pages.id, ids)).orderBy(pages.id);
    return (await (lock ? query.for("update") : query)).map((r) => ({ id: r.id, localRev: r.rev, row: pageToSync(r) }));
  }
  if (kind === "media") {
    const query = tx.select().from(media).where(inArray(media.id, ids)).orderBy(media.id);
    return (await (lock ? query.for("update") : query)).map((r) => ({ id: r.id, localRev: r.rev, row: mediaToSync(r) }));
  }
  const query = tx.select().from(iconImages).where(inArray(iconImages.id, ids)).orderBy(iconImages.id);
  return (await (lock ? query.for("update") : query)).map((r) => ({ id: r.id, localRev: r.rev, row: iconImageToSync(r) }));
}

async function readBases(tx: Tx | typeof db, kind: SyncKind, ids: string[]): Promise<Map<string, BaseEntry>> {
  if (!ids.length) return new Map();
  const rows = await tx.select().from(syncBase).where(and(eq(syncBase.kind, kind), inArray(syncBase.id, ids)));
  return new Map(rows.map((r) => [r.id, { kind, id: r.id, rev: r.rev, hash: r.hash, snapshot: r.snapshot as SyncRow }]));
}

// Lignes touchées depuis le dernier passage (pré-filtre : révision locale
// différente de celle notée dans sync_base, ou absente d'un des deux côtés),
// puis tranchées par empreinte. clean : touchées sans rien changer, leur
// révision locale est notée au prochain passage pour ne plus les relire.
export type Scan = { pending: Candidate[]; clean: { kind: SyncKind; id: string; localRev: number }[] };

export async function scanLocal(): Promise<Scan> {
  const scan: Scan = { pending: [], clean: [] };
  for (const kind of SYNC_KINDS) {
    const table = TABLES[kind];
    const touched = await db.execute<{ id: string }>(sql`
      SELECT t.id FROM ${table} t LEFT JOIN sync_base b ON b.kind = ${kind} AND b.id = t.id
      WHERE b.id IS NULL OR b.local_rev <> t.rev`);
    const ids = touched.rows.map((r) => r.id);
    const bases = await readBases(db, kind, ids);
    for (const local of await readLocal(db, kind, ids)) {
      const candidate: Candidate = { kind, id: local.id, row: local.row, base: bases.get(local.id) ?? null };
      if (isPending(candidate)) scan.pending.push(candidate);
      else scan.clean.push({ kind, id: local.id, localRev: local.localRev });
    }
    const gone = await db.execute<{ id: string }>(sql`
      SELECT b.id FROM sync_base b WHERE b.kind = ${kind} AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = b.id)`);
    const goneBases = await readBases(db, kind, gone.rows.map((r) => r.id));
    for (const base of goneBases.values()) scan.pending.push({ kind, id: base.id, row: null, base });
  }
  return scan;
}

// --- Application de ce qui est reçu ------------------------------------------------

export type ApplyInput = {
  changes: Change[];
  sent: ReadonlyMap<RowKey, string | null>;
  clean: Scan["clean"];
  cursor: string;
};
export type ApplyOutcome = { applied: number; kept: number; removedFiles: string[]; skipped: string[] };

// Tout ce que le cycle a reçu (réponses à l'envoi et lots du flux), en une
// transaction : un lot du flux n'est pas dans l'ordre des clés étrangères,
// l'ensemble l'est une fois trié parents d'abord. Le curseur n'avance qu'avec
// les lignes : une coupure fait tout relire au cycle suivant, sans effet sur
// ce qui était déjà là.
export async function applyIncoming(input: ApplyInput): Promise<ApplyOutcome> {
  return db.transaction(async (tx) => {
    const outcome: ApplyOutcome = { applied: 0, kept: 0, removedFiles: [], skipped: [] };
    const accepted: Change[] = [];
    const bases = new Map<RowKey, BaseEntry>();
    const locals = new Map<RowKey, Local>();

    for (const kind of SYNC_KINDS) {
      const ids = input.changes.filter((c) => c.kind === kind).map((c) => c.id);
      for (const [id, base] of await readBases(tx, kind, ids)) bases.set(rowKey(kind, id), base);
      for (const local of await readLocal(tx, kind, ids, true)) locals.set(rowKey(kind, local.id), local);
    }
    for (const change of input.changes) {
      const key = rowKey(change.kind, change.id);
      const local = locals.get(key);
      const decision = decideIncoming(change, local ? rowHash(local.row) : null, bases.get(key) ?? null, input.sent.get(key));
      if (decision === "apply") accepted.push(change);
      if (decision === "keep") outcome.kept++;
    }

    const order = applyOrder(accepted);
    const record = async (kind: SyncKind, id: string, rev: number, localRev: number, row: SyncRow) => {
      const values = { rev, localRev, hash: rowHash(row), snapshot: row };
      await tx.insert(syncBase).values({ kind, id, ...values }).onConflictDoUpdate({ target: [syncBase.kind, syncBase.id], set: values });
      outcome.applied++;
    };
    const revOf = new Map(accepted.map((c) => [rowKey(c.kind, c.id), c.rev]));

    // Pages, parents d'abord. Un seul Vide-cerveau : celui du serveur garde le
    // rôle, celui créé sur le Mac avant la première synchronisation devient une
    // base ordinaire (le serveur ferait de même en le recevant).
    const known = new Set((await tx.select({ id: pages.id }).from(pages)).map((r) => r.id));
    const properties = new Map<string, Property[]>();
    for (const incoming of order.pages) {
      const row = localPage(incoming, (id) => known.has(id));
      if (!row) {
        outcome.skipped.push(`page ${incoming.id} : base absente du Mac`);
        continue;
      }
      if (row.isInbox) await tx.update(pages).set({ isInbox: false, updatedAt: sql`${pages.updatedAt}` }).where(and(eq(pages.isInbox, true), sql`${pages.id} <> ${row.id}`));
      const localRev = await writePage(tx, row, properties);
      known.add(row.id);
      await record("page", row.id, revOf.get(rowKey("page", row.id))!, localRev, incoming);
    }

    for (const row of order.media) {
      const localRev = await writeMedia(tx, { ...row, pageId: row.pageId && known.has(row.pageId) ? row.pageId : null });
      await record("media", row.id, revOf.get(rowKey("media", row.id))!, localRev, row);
    }

    const mediaIds = order.iconImages.map((r) => r.mediaId);
    const files = new Set(mediaIds.length ? (await tx.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))).map((r) => r.id) : []);
    for (const row of order.iconImages) {
      if (!files.has(row.mediaId)) {
        outcome.skipped.push(`icon_image ${row.id} : média absent du Mac`);
        continue;
      }
      const localRev = await writeIconImage(tx, row);
      await record("icon_image", row.id, revOf.get(rowKey("icon_image", row.id))!, localRev, row);
    }

    for (const { kind, id } of order.deletions) {
      const local = locals.get(rowKey(kind, id));
      if (kind === "media" && local) outcome.removedFiles.push((local.row as SyncMedia).filename);
      if (local) await tx.delete(TABLES[kind]).where(eq(TABLES[kind].id, id));
      await tx.delete(syncBase).where(and(eq(syncBase.kind, kind), eq(syncBase.id, id)));
      outcome.applied++;
    }

    // Lignes réécrites sans changement : leur révision locale est notée, sauf
    // si ce cycle vient de les écrire (sa révision est déjà la bonne).
    for (const { kind, id, localRev } of input.clean) {
      if (revOf.has(rowKey(kind, id))) continue;
      await tx.update(syncBase).set({ localRev }).where(and(eq(syncBase.kind, kind), eq(syncBase.id, id)));
    }

    const state = { cursor: input.cursor, syncedAt: new Date(), error: null, updatedAt: new Date() };
    await tx.insert(syncState).values({ id: 1, ...state }).onConflictDoUpdate({ target: syncState.id, set: state });
    return outcome;
  });
}

// Une page reçue, écrite telle quelle (ni configuration ni valeurs
// réinterprétées : l'empreinte relue doit égaler celle reçue), champs dérivés
// recalculés. updated_at explicite : sans lui, $onUpdate de Drizzle mettrait
// l'heure du Mac. Rend la révision locale posée par le déclencheur.
async function writePage(tx: Tx, row: SyncPage, properties: Map<string, Property[]>): Promise<number> {
  let valuesText = "";
  if (row.type === "entry" && row.dbId) {
    let props = properties.get(row.dbId);
    if (!props) {
      const [database] = await tx.select({ dbConfig: pages.dbConfig }).from(pages).where(eq(pages.id, row.dbId));
      props = parseConfig(database?.dbConfig).properties;
      properties.set(row.dbId, props);
    }
    valuesText = valuesToText(props, normalizeValues(props, row.propertyValues));
  }
  if (row.type === "database") properties.delete(row.id);

  const values = {
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    coverPosition: row.coverPosition,
    body: row.body,
    bodyText: flattenToText(row.body),
    dbConfig: row.dbConfig,
    dbId: row.dbId,
    propertyValues: row.propertyValues,
    valuesText,
    inboxKind: row.inboxKind,
    isInbox: row.isInbox,
    manualOrder: row.manualOrder,
    shareEnabled: row.shareEnabled,
    publicId: row.publicId,
    shareIncludeSubpages: row.shareIncludeSubpages,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    trashedAt: row.trashedAt ? new Date(row.trashedAt) : null,
  };
  const [written] = await tx
    .insert(pages)
    .values({ id: row.id, ...values })
    .onConflictDoUpdate({ target: pages.id, set: values })
    .returning({ rev: pages.rev });
  return written.rev;
}

async function writeMedia(tx: Tx, row: SyncMedia): Promise<number> {
  const values = {
    filename: row.filename,
    originalName: row.originalName,
    mime: row.mime,
    size: row.size,
    pageId: row.pageId,
    unusedSince: row.unusedSince ? new Date(row.unusedSince) : null,
    createdAt: new Date(row.createdAt),
  };
  const [written] = await tx
    .insert(media)
    .values({ id: row.id, ...values })
    .onConflictDoUpdate({ target: media.id, set: values })
    .returning({ rev: media.rev });
  return written.rev;
}

async function writeIconImage(tx: Tx, row: SyncIconImage): Promise<number> {
  const values = { mediaId: row.mediaId, name: row.name, hidden: row.hidden, createdAt: new Date(row.createdAt) };
  const [written] = await tx
    .insert(iconImages)
    .values({ id: row.id, ...values })
    .onConflictDoUpdate({ target: iconImages.id, set: values })
    .returning({ rev: iconImages.rev });
  return written.rev;
}

// --- État ---------------------------------------------------------------------------

export type SyncStateRow = typeof syncState.$inferSelect;

export async function readState(): Promise<SyncStateRow | null> {
  const [row] = await db.select().from(syncState).where(eq(syncState.id, 1));
  return row ?? null;
}

export async function recordError(message: string): Promise<void> {
  const values = { error: message, updatedAt: new Date() };
  await db.insert(syncState).values({ id: 1, ...values }).onConflictDoUpdate({ target: syncState.id, set: values });
}

// Fichiers attendus sur le disque du Mac : tous les médias connus.
export async function listMediaFiles(): Promise<{ filename: string; size: number }[]> {
  return db.select({ filename: media.filename, size: media.size }).from(media);
}
