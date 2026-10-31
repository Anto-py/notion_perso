// Protocole de synchronisation avec l'app Mac (SPECS.md, « Synchronisation
// avec l'app Mac »), partie pure : forme des lignes qui voyagent, contrôle de
// ce que le Mac envoie, comparaison des versions, et décision pour chaque
// ligne poussée. Les lectures et écritures sont dans sync_server.ts.
import type { iconImages, media, pages } from "@/db/schema";
import { isOrderKey } from "./order_key";
import { mergePage, type SyncPage } from "./sync_merge";
import { isStoredName } from "./upload_rules";

export type SyncKind = "page" | "media" | "icon_image";
export const SYNC_KINDS: readonly SyncKind[] = ["page", "media", "icon_image"];

export type SyncMedia = {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  pageId: string | null;
  unusedSince: string | null;
  createdAt: string;
};

export type SyncIconImage = { id: string; mediaId: string; name: string; hidden: boolean; createdAt: string };

// Un changement lu par le Mac : la ligne entière, ou sa suppression.
export type Change =
  | { kind: "page"; id: string; rev: number; row: SyncPage }
  | { kind: "media"; id: string; rev: number; row: SyncMedia }
  | { kind: "icon_image"; id: string; rev: number; row: SyncIconImage }
  | { kind: SyncKind; id: string; rev: number; deleted: true };

// Une ligne poussée par le Mac, avec la révision et la version de la ligne
// qu'il avait reçues (sa base commune), nulles pour une ligne qu'il a créée.
// Un média ne fait que s'ajouter : le serveur reste seul juge de son effacement.
export type PushItem =
  | { kind: "page"; id: string; baseRev: number | null; base: SyncPage | null; row: SyncPage }
  | { kind: "icon_image"; id: string; baseRev: number | null; base: SyncIconImage | null; row: SyncIconImage }
  | { kind: "media"; id: string; row: SyncMedia }
  | { kind: SyncKind; id: string; baseRev: number; deleted: true };

// Lignes par lot, à la lecture comme à l'envoi.
export const SYNC_BATCH = 200;

// --- Lignes de la base vers le format d'échange ------------------------------

type PageRow = typeof pages.$inferSelect;
type MediaRow = typeof media.$inferSelect;
type IconImageRow = typeof iconImages.$inferSelect;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

// Sans les champs dérivés (body_text, values_text, search_vector), recalculés
// à la réception, ni rev et sync_xid, propres à chaque instance.
export function pageToSync(row: PageRow): SyncPage {
  return {
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    coverPosition: row.coverPosition,
    body: row.body,
    dbConfig: row.dbConfig,
    dbId: row.dbId,
    propertyValues: (row.propertyValues as Record<string, unknown> | null) ?? null,
    inboxKind: row.inboxKind,
    isInbox: row.isInbox,
    manualOrder: row.manualOrder,
    shareEnabled: row.shareEnabled,
    publicId: row.publicId,
    shareIncludeSubpages: row.shareIncludeSubpages,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    trashedAt: iso(row.trashedAt),
  };
}

export function mediaToSync(row: MediaRow): SyncMedia {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mime: row.mime,
    size: row.size,
    pageId: row.pageId,
    unusedSince: iso(row.unusedSince),
    createdAt: row.createdAt.toISOString(),
  };
}

export function iconImageToSync(row: IconImageRow): SyncIconImage {
  return { id: row.id, mediaId: row.mediaId, name: row.name, hidden: row.hidden, createdAt: row.createdAt.toISOString() };
}

// --- Contrôle de ce que le Mac envoie ---------------------------------------

// Les ids viennent de newId (pg_…, up_…) ; un import ou une version ancienne
// peut en porter d'autres, d'où une règle large mais bornée.
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 10_000;

type Check = (value: unknown) => boolean;
const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isId: Check = (value) => typeof value === "string" && ROW_ID.test(value);
const isText: Check = (value) => typeof value === "string" && value.length <= MAX_TEXT;
const isDate: Check = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isBool: Check = (value) => typeof value === "boolean";
const isRev = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const orNull = (check: Check): Check => (value) => value === null || check(value);
const oneOf = (...allowed: unknown[]): Check => (value) => allowed.includes(value);

const PAGE_FIELDS: Record<keyof SyncPage, Check> = {
  id: isId,
  parentId: orNull(isId),
  type: oneOf("page", "database", "entry"),
  title: isText,
  icon: orNull(isText),
  cover: orNull(isText),
  coverPosition: orNull((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100),
  body: Array.isArray,
  dbConfig: (v) => v === null || isObj(v),
  dbId: orNull(isId),
  propertyValues: (v) => v === null || isObj(v),
  inboxKind: oneOf(null, "link", "note"),
  isInbox: isBool,
  manualOrder: isOrderKey,
  shareEnabled: isBool,
  publicId: orNull(isText),
  shareIncludeSubpages: isBool,
  createdAt: isDate,
  updatedAt: isDate,
  trashedAt: orNull(isDate),
};

const MEDIA_FIELDS: Record<keyof SyncMedia, Check> = {
  id: isId,
  filename: (v) => typeof v === "string" && isStoredName(v),
  originalName: isText,
  mime: isText,
  size: (v) => Number.isSafeInteger(v) && (v as number) >= 0,
  pageId: orNull(isId),
  unusedSince: orNull(isDate),
  createdAt: isDate,
};

const ICON_IMAGE_FIELDS: Record<keyof SyncIconImage, Check> = {
  id: isId,
  mediaId: isId,
  name: isText,
  hidden: isBool,
  createdAt: isDate,
};

// La ligne réduite aux champs connus, ou le nom du premier champ irrecevable.
function readRow<T>(raw: unknown, fields: Record<keyof T, Check>): T | string {
  if (!isObj(raw)) return "ligne absente";
  const row: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(fields) as [string, Check][]) {
    if (!check(raw[key])) return `champ ${key}`;
    row[key] = raw[key];
  }
  return row as T;
}

// Une entrée vit dans une base, et seule une entrée.
function readPage(raw: unknown): SyncPage | string {
  const row = readRow<SyncPage>(raw, PAGE_FIELDS);
  if (typeof row === "string") return row;
  if ((row.type === "entry") !== (row.dbId !== null)) return "champ dbId";
  return row;
}

const READERS = {
  page: readPage,
  media: (raw: unknown) => readRow<SyncMedia>(raw, MEDIA_FIELDS),
  icon_image: (raw: unknown) => readRow<SyncIconImage>(raw, ICON_IMAGE_FIELDS),
};

function readItem(raw: unknown): PushItem | string {
  if (!isObj(raw)) return "élément illisible";
  const { kind, id } = raw;
  if (!SYNC_KINDS.includes(kind as SyncKind) || !isId(id)) return "kind ou id illisible";
  const where = `${kind} ${id as string}`;

  if (raw.deleted === true) {
    if (!isRev(raw.baseRev)) return `${where} : baseRev attendue pour une suppression`;
    return { kind: kind as SyncKind, id: id as string, baseRev: raw.baseRev, deleted: true };
  }

  const row = READERS[kind as SyncKind](raw.row);
  if (typeof row === "string") return `${where} : ${row}`;
  if (row.id !== id) return `${where} : id de la ligne différent`;
  if (kind === "media") return { kind, id, row: row as SyncMedia };

  const baseRev = raw.baseRev ?? null;
  if (baseRev !== null && !isRev(baseRev)) return `${where} : baseRev illisible`;
  let base: SyncPage | SyncIconImage | null = null;
  if (raw.base != null) {
    const read = READERS[kind as "page" | "icon_image"](raw.base);
    if (typeof read === "string") return `${where} : base, ${read}`;
    base = read;
  }
  return { kind, id, baseRev, base, row } as PushItem;
}

// Le corps d'un envoi : { items: [...] }, au plus un lot, chaque ligne une fois.
export function parsePush(raw: unknown): PushItem[] | string {
  if (!isObj(raw) || !Array.isArray(raw.items)) return "Corps attendu : { items: [...] }";
  if (raw.items.length > SYNC_BATCH) return `Au plus ${SYNC_BATCH} lignes par envoi`;
  const items: PushItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of raw.items) {
    const item = readItem(rawItem);
    if (typeof item === "string") return item;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return `${key} envoyée deux fois`;
    seen.add(key);
    items.push(item);
  }
  return items;
}

// Curseur du flux : un xid8 PostgreSQL, en chiffres. after : dernière
// révision lue dans le cycle en cours.
export function readCursor(raw: string | null): string | null {
  const value = raw ?? "0";
  return /^\d{1,20}$/.test(value) ? value : null;
}

export function readAfter(raw: string | null): number | null {
  const value = Number(raw ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// --- Versions ----------------------------------------------------------------

// schema : `when` de la dernière migration (_journal.json). commit : celui
// du build, quand il est connu.
export type SyncVersion = { schema: number; commit: string | null };

// Message du refus, ou null si les deux instances peuvent échanger. Un commit
// inconnu d'un côté ne bloque pas : seul le schéma est indispensable.
export function versionGap(server: SyncVersion, client: { schema: string | null; commit: string | null }): string | null {
  if (client.schema === null || !/^\d+$/.test(client.schema)) return "Version du schéma absente de la requête (X-Sync-Schema).";
  const schema = Number(client.schema);
  if (schema !== server.schema) {
    const advice = schema < server.schema ? "Redémarrez l'app Mac pour la mettre à jour." : "Le serveur n'est pas encore à jour : déployez-le d'abord.";
    return `Schéma différent (serveur ${server.schema}, Mac ${schema}). ${advice}`;
  }
  if (server.commit && client.commit && server.commit !== client.commit) {
    return `Code différent (serveur ${server.commit.slice(0, 7)}, Mac ${client.commit.slice(0, 7)}). Redémarrez l'app Mac pour la mettre à jour.`;
  }
  return null;
}

// --- Décisions -----------------------------------------------------------------

export type ServerRow<T> = { rev: number; row: T };

export type PageDecision = { row: SyncPage; conflicts: number; revived: boolean };

// Une page poussée. Le serveur n'a pas bougé depuis la base du Mac : la
// version du Mac passe telle quelle. Il a bougé : fusion à trois versions.
// Purgée sur le serveur entre-temps : la purge gagne, mais la version du Mac
// revient en corbeille pour 30 jours plutôt que d'être perdue (choix
// d'Antonin du 2026-10-31).
export function decidePage(
  item: Extract<PushItem, { kind: "page"; row: SyncPage }>,
  server: ServerRow<SyncPage> | null,
  purged: boolean,
  now: string,
  makeId?: () => string,
): PageDecision {
  if (!server) {
    return purged
      ? { row: { ...item.row, trashedAt: now }, conflicts: 0, revived: true }
      : { row: item.row, conflicts: 0, revived: false };
  }
  if (item.baseRev !== null && server.rev === item.baseRev) return { row: item.row, conflicts: 0, revived: false };
  const merged = mergePage(item.base, item.row, server.row, makeId);
  return { row: merged.page, conflicts: merged.conflicts, revived: false };
}

// Une suppression poussée. gone : déjà absente. delete : le serveur n'a pas
// bougé depuis la base du Mac. trash : modifiée ailleurs entre-temps, elle
// reste, en corbeille (même règle que decidePage, dans l'autre sens).
export type DeletionDecision = "gone" | "delete" | "trash";

export function decideDeletion(baseRev: number, server: { rev: number } | null): DeletionDecision {
  if (!server) return "gone";
  return server.rev === baseRev ? "delete" : "trash";
}

// Image d'icône : nom et visibilité, champ par champ. Sans date de
// modification pour départager, le serveur garde le sien quand les deux
// côtés ont changé le même champ.
export function decideIconImage(
  item: Extract<PushItem, { kind: "icon_image"; row: SyncIconImage }>,
  server: ServerRow<SyncIconImage> | null,
): SyncIconImage {
  if (!server || (item.baseRev !== null && server.rev === item.baseRev)) return item.row;
  const base = item.base;
  const field = <K extends "name" | "hidden">(key: K): SyncIconImage[K] =>
    base && server.row[key] === base[key] ? item.row[key] : server.row[key];
  return { ...server.row, name: field("name"), hidden: field("hidden") };
}

// Ordre d'écriture d'un lot de pages : une page que d'autres du même lot
// désignent comme parent ou comme base passe avant elles, pour que leur clé
// étrangère trouve sa cible. Une boucle (impossible depuis une instance saine)
// garde l'ordre reçu.
export function writeOrder(rows: readonly SyncPage[]): SyncPage[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const ordered: SyncPage[] = [];
  const visit = (row: SyncPage) => {
    if (done.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    for (const ref of [row.dbId, row.parentId]) {
      const target = ref ? byId.get(ref) : undefined;
      if (target) visit(target);
    }
    visiting.delete(row.id);
    done.add(row.id);
    ordered.push(row);
  };
  rows.forEach(visit);
  return ordered;
}
