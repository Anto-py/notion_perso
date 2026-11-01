// Synchronisation côté Mac (SPECS.md, « Synchronisation avec l'app Mac »),
// partie pure : empreinte d'une ligne, ce qui attend d'être envoyé, ordre des
// envois, et ce qu'on écrit en local à la réception. Les lectures, écritures
// et appels au serveur sont dans sync_client.ts.
import { createHash } from "node:crypto";
import { bodyHasContent } from "./blocks";
import type { SyncPage } from "./sync_merge";
import { SYNC_BATCH, writeOrder, type Change, type PushItem, type SyncIconImage, type SyncKind, type SyncMedia } from "./sync_protocol";

export type SyncRow = SyncPage | SyncMedia | SyncIconImage;
export type RowKey = string;
export const rowKey = (kind: SyncKind, id: string): RowKey => `${kind}:${id}`;

// JSON aux clés triées, à toute profondeur : jsonb réordonne les clés d'un
// objet, et deux lectures d'une même ligne doivent donner la même empreinte.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function rowHash(row: SyncRow): string {
  return createHash("sha256").update(canonicalJson(row)).digest("base64url");
}

// La dernière version reçue du serveur pour une ligne (table sync_base).
export type BaseEntry = { kind: SyncKind; id: string; rev: number; hash: string; snapshot: SyncRow };

// Une ligne locale à examiner : sa version actuelle (null si effacée sur le
// Mac) et sa base (null si créée sur le Mac).
export type Candidate = { kind: SyncKind; id: string; row: SyncRow | null; base: BaseEntry | null };

// En attente : créée, effacée ou modifiée sur le Mac depuis la dernière
// version reçue. Une écriture qui ne change rien (même empreinte) n'attend pas.
export function isPending(candidate: Candidate): boolean {
  if (!candidate.row) return candidate.base !== null;
  return !candidate.base || rowHash(candidate.row) !== candidate.base.hash;
}

// --- Envoi ----------------------------------------------------------------------

export type PushPlan = {
  batches: PushItem[][];
  // Empreinte de ce qui est parti, null pour une suppression : la réponse du
  // serveur ne s'écrit en local que si la ligne n'a pas bougé depuis.
  sent: Map<RowKey, string | null>;
};

const deletionRank = (candidate: Candidate): number => {
  if (candidate.kind === "icon_image") return 0;
  if (candidate.kind === "media") return 4;
  const type = (candidate.base?.snapshot as SyncPage | undefined)?.type;
  return type === "entry" ? 1 : type === "database" ? 3 : 2;
};

// Lignes en attente, dans l'ordre qui épargne au serveur des décisions de
// repli : pages parent d'abord (un parent absent renverrait l'enfant à la
// racine), médias avant les images d'icône qui les citent ; puis les
// suppressions, entrées avant leur base (une base n'est effacée que si toutes
// ses entrées le sont) et médias en dernier (effacés seulement si plus rien
// ne les cite). Un média ne fait que s'ajouter ; renvoyé alors qu'il existe,
// le serveur l'ignore et rend sa version, que le Mac reprend.
export function planPush(pending: readonly Candidate[]): PushPlan {
  const sent = new Map<RowKey, string | null>();
  const upserts = pending.filter((candidate) => candidate.row);
  const pages = writeOrder(upserts.filter((c) => c.kind === "page").map((c) => c.row as SyncPage));
  const byKey = new Map(upserts.map((candidate) => [rowKey(candidate.kind, candidate.id), candidate]));

  const items: PushItem[] = [];
  const upsert = (candidate: Candidate) => {
    const row = candidate.row!;
    sent.set(rowKey(candidate.kind, candidate.id), rowHash(row));
    if (candidate.kind === "media") {
      items.push({ kind: "media", id: candidate.id, row: row as SyncMedia });
      return;
    }
    const base = candidate.base;
    items.push({
      kind: candidate.kind,
      id: candidate.id,
      baseRev: base?.rev ?? null,
      base: base?.snapshot ?? null,
      row,
    } as PushItem);
  };
  for (const page of pages) upsert(byKey.get(rowKey("page", page.id))!);
  for (const kind of ["media", "icon_image"] as const) upserts.filter((c) => c.kind === kind).forEach(upsert);

  const removals = pending.filter((candidate) => !candidate.row && candidate.base);
  removals.sort((a, b) => deletionRank(a) - deletionRank(b));
  for (const candidate of removals) {
    sent.set(rowKey(candidate.kind, candidate.id), null);
    items.push({ kind: candidate.kind, id: candidate.id, baseRev: candidate.base!.rev, deleted: true });
  }

  const batches: PushItem[][] = [];
  for (let i = 0; i < items.length; i += SYNC_BATCH) batches.push(items.slice(i, i + SYNC_BATCH));
  return { batches, sent };
}

// --- Réception -------------------------------------------------------------------

// Révision donnée à une suppression confirmée par le serveur en réponse à un
// envoi, qui n'en porte pas : elle passe devant toute version lue de la ligne.
export const CONFIRMED_DELETION = Number.MAX_SAFE_INTEGER;

// Une ligne peut revenir plusieurs fois dans un cycle (réponse à l'envoi,
// puis lots du flux, relus quand elle a changé entre deux lots) : seule
// compte sa version la plus récente.
export function latestChanges(changes: Iterable<Change>): Map<RowKey, Change> {
  const latest = new Map<RowKey, Change>();
  for (const change of changes) {
    const key = rowKey(change.kind, change.id);
    const known = latest.get(key);
    if (!known || change.rev >= known.rev) latest.set(key, change);
  }
  return latest;
}

// Ce qu'on fait d'un changement reçu. apply : la ligne locale est telle que
// le cycle l'attendait (sa base, ou ce qui vient de partir), on l'écrase.
// keep : elle a bougé sur le Mac, on la laisse ; elle partira au cycle
// suivant et le serveur fera la fusion. same : déjà reçue, rien à écrire.
export type IncomingDecision = "apply" | "keep" | "same";

export function decideIncoming(
  change: Change,
  localHash: string | null,
  base: BaseEntry | null,
  sent: string | null | undefined,
): IncomingDecision {
  if (sent === undefined && base && change.rev <= base.rev) return "same";
  const expected = sent !== undefined ? sent : (base?.hash ?? null);
  return localHash === expected ? "apply" : "keep";
}

// Les écritures d'un cycle, dans l'ordre des clés étrangères : pages parent
// d'abord (writeOrder), médias, images d'icône ; les suppressions ensuite.
export type ApplyOrder = {
  pages: SyncPage[];
  media: SyncMedia[];
  iconImages: SyncIconImage[];
  deletions: { kind: SyncKind; id: string }[];
};

export function applyOrder(changes: readonly Change[]): ApplyOrder {
  const order: ApplyOrder = { pages: [], media: [], iconImages: [], deletions: [] };
  const pages: SyncPage[] = [];
  for (const change of changes) {
    if ("deleted" in change) order.deletions.push({ kind: change.kind, id: change.id });
    else if (change.kind === "page") pages.push(change.row);
    else if (change.kind === "media") order.media.push(change.row);
    else order.iconImages.push(change.row);
  }
  order.pages = writeOrder(pages);
  const rank: Record<SyncKind, number> = { icon_image: 0, media: 1, page: 2 };
  order.deletions.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return order;
}

// Une page reçue dont la cible n'existe pas sur le Mac (effacée ici pendant
// le cycle) : un parent absent la range à la racine, comme ON DELETE SET
// NULL ; une entrée sans sa base n'a pas où vivre, elle n'est pas écrite
// (null). La ligne écrite diffère alors de la base : elle part au cycle suivant.
export function localPage(row: SyncPage, exists: (id: string) => boolean): SyncPage | null {
  if (row.dbId && !exists(row.dbId)) return null;
  if (row.parentId && !exists(row.parentId)) return { ...row, parentId: null };
  return row;
}

// --- Suspension automatique -----------------------------------------------------
//
// Un cycle qui enverrait, ou écrirait, plus de pages abîmées que le seuil
// s'arrête et se suspend (SPECS.md, « Suspension automatique »). Une page
// abîmée : mise en corbeille, corps qui pesait vidé, ou purgée alors qu'elle
// n'était pas en corbeille. Purger une page déjà en corbeille confirme un
// geste compté le jour de la mise en corbeille (choix d'Antonin du 2026-11-01) ;
// la vider aussi.

export type DamageKind = "trashed" | "emptied" | "purged";
export type Damage = { count: number; kinds: Record<DamageKind, number>; titles: string[] };
// before : la page telle qu'on la tient ; after : ce qu'elle deviendrait,
// null pour une purge. before null : page inconnue ici, rien à abîmer.
export type PageChange = { before: SyncPage | null; after: SyncPage | null };

const DAMAGE_TITLES = 5;

function damageOf({ before, after }: PageChange): DamageKind | null {
  // Rien de ce qui arrive à une page déjà en corbeille ne compte.
  if (!before || before.trashedAt !== null) return null;
  if (!after) return "purged";
  if (after.trashedAt !== null) return "trashed";
  if (bodyHasContent(before.body) && !bodyHasContent(after.body)) return "emptied";
  return null;
}

export function countDamage(changes: Iterable<PageChange>): Damage {
  const damage: Damage = { count: 0, kinds: { trashed: 0, emptied: 0, purged: 0 }, titles: [] };
  for (const change of changes) {
    const kind = damageOf(change);
    if (!kind) continue;
    damage.count++;
    damage.kinds[kind]++;
    if (damage.titles.length < DAMAGE_TITLES) damage.titles.push(change.before!.title);
  }
  return damage;
}

// Sens montant : chaque page en attente contre sa dernière version reçue.
export function pendingPageChanges(pending: readonly Candidate[]): PageChange[] {
  return pending
    .filter((candidate) => candidate.kind === "page")
    .map((candidate) => ({
      before: (candidate.base?.snapshot as SyncPage | undefined) ?? null,
      after: candidate.row as SyncPage | null,
    }));
}

// Sens descendant : chaque page reçue contre la ligne locale du même id.
export function incomingPageChanges(changes: readonly Change[], locals: ReadonlyMap<string, SyncPage>): PageChange[] {
  return changes
    .filter((change) => change.kind === "page")
    .map((change) => ({
      before: locals.get(change.id) ?? null,
      after: "deleted" in change ? null : (change.row as SyncPage),
    }));
}
