// Vide-cerveau : la base Inbox, son schéma de départ et la capture rapide
// (note ou lien). Une seule base porte le rôle, garanti par l'index unique
// partiel pages_inbox_idx ; elle est créée à la première visite de /inbox.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { CAPTURE_TITLE_MAX, noteFromText } from "./capture";
import { COVER_POSITION_DEFAULT, imageCover } from "./covers";
import { keyAfterLast, updateDatabase } from "./databases";
import { newId } from "./ids";
import { recordMedia, updatePage, type Page } from "./pages";
import { valuesToText, type Property, type Values } from "./properties";
import { parseConfig, sanitizeView, type DbConfig } from "./views";
import { domainOf } from "./unfurl";
import { fetchRemoteImage } from "./unfurl_fetch";
import { saveFile } from "./storage";

export const INBOX_TITLE = "Vide-cerveau";
export const INBOX_URL_PROP = "prop_inbox_url";
export const INBOX_PREVIEW_PROP = "prop_inbox_preview";
export const INBOX_SOURCE_PROP = "prop_inbox_source";

// Trois propriétés suffisent : l'adresse, l'aperçu et la source d'un lien
// (« ARTE », « Le Monde »). Une note n'a que son corps.
export function inboxConfig(): DbConfig {
  return {
    properties: [
      { id: INBOX_URL_PROP, name: "URL", type: "url" },
      { id: INBOX_PREVIEW_PROP, name: "Aperçu", type: "text" },
      { id: INBOX_SOURCE_PROP, name: "Source", type: "text" },
    ],
    views: [sanitizeView({ sorts: [{ prop: "created_at", dir: "desc" }] }, [])],
  };
}

export async function getInbox(): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.isInbox, true), eq(pages.type, "database"), isNull(pages.trashedAt)))
    .limit(1);
  return row ?? null;
}

// Une Inbox née avant l'ajout d'une propriété (Source, par exemple) la reçoit
// à la première visite : les valeurs des entrées existantes ne bougent pas.
async function migrateInboxProperties(inbox: Page): Promise<Page> {
  const config = parseConfig(inbox.dbConfig);
  const missing = inboxConfig().properties.filter((wanted) => !config.properties.some((prop) => prop.id === wanted.id));
  if (missing.length === 0) return inbox;
  await updateDatabase(inbox.id, { properties: [...config.properties, ...missing] });
  return (await getInbox()) ?? inbox;
}

// Création paresseuse. ON CONFLICT DO NOTHING couvre l'index unique partiel :
// deux onglets ouverts en même temps ne créent pas deux Vide-cerveau.
export async function ensureInbox(): Promise<Page> {
  const existing = await getInbox();
  if (existing) return migrateInboxProperties(existing);
  const [created] = await db
    .insert(pages)
    .values({
      id: newId("pg"),
      type: "database",
      title: INBOX_TITLE,
      dbConfig: inboxConfig(),
      isInbox: true,
    })
    .onConflictDoNothing()
    .returning();
  const inbox = created ?? (await getInbox());
  if (!inbox) throw new Error("Vide-cerveau introuvable après création");
  return inbox;
}

// Une entrée de l'Inbox, en fin d'ordre manuel, comme createEntry.
async function insertCapture(
  inboxId: string,
  properties: readonly Property[],
  values: Values,
  row: { title: string; body?: unknown[]; bodyText?: string; kind: "note" | "link" },
): Promise<string> {
  const manualOrder = await keyAfterLast(db, inboxId);
  const id = newId("pg");
  await db.insert(pages).values({
    id,
    type: "entry",
    dbId: inboxId,
    title: row.title,
    body: row.body ?? [],
    bodyText: row.bodyText ?? "",
    propertyValues: values,
    valuesText: valuesToText(properties, values),
    inboxKind: row.kind,
    manualOrder,
  });
  return id;
}

export async function captureNote(text: string): Promise<{ id: string }> {
  const inbox = await ensureInbox();
  const note = noteFromText(text);
  const id = await insertCapture(inbox.id, parseConfig(inbox.dbConfig).properties, {}, {
    title: note.title,
    body: note.body,
    bodyText: note.bodyText,
    kind: "note",
  });
  return { id };
}

export type LinkCapture = { url: string; title?: string; description?: string; source?: string; image?: string | null };

// L'image Open Graph est rapatriée dans les médias et posée en bandeau : elle
// survit à l'expiration de l'adresse distante et illustre la Galerie
// (BRAINSTORMING §5). Un échec laisse la capture sans bandeau, sans erreur.
async function attachCover(pageId: string, imageUrl: string): Promise<void> {
  const remote = await fetchRemoteImage(imageUrl);
  if (!remote) return;
  const mediaId = newId("up");
  const filename = `${mediaId}.${remote.ext}`;
  try {
    await saveFile(new Blob([remote.bytes]).stream(), filename);
  } catch {
    return;
  }
  await recordMedia({
    id: mediaId,
    filename,
    originalName: filename,
    mime: remote.mime,
    size: remote.bytes.byteLength,
    pageId,
  });
  await updatePage(pageId, { cover: imageCover(filename), coverPosition: COVER_POSITION_DEFAULT });
}

// Un lien capturé garde son URL même sans métadonnées : le titre retombe sur
// le domaine, la description et la source restent vides.
export async function captureLink(link: LinkCapture): Promise<{ id: string }> {
  const inbox = await ensureInbox();
  const properties = parseConfig(inbox.dbConfig).properties;
  const values: Values = {};
  if (properties.some((prop) => prop.id === INBOX_URL_PROP)) values[INBOX_URL_PROP] = link.url;
  if (link.description && properties.some((prop) => prop.id === INBOX_PREVIEW_PROP)) {
    values[INBOX_PREVIEW_PROP] = link.description.slice(0, 5000);
  }
  if (link.source && properties.some((prop) => prop.id === INBOX_SOURCE_PROP)) {
    values[INBOX_SOURCE_PROP] = link.source.slice(0, 100);
  }
  const title = (link.title?.trim() || domainOf(link.url)).slice(0, CAPTURE_TITLE_MAX);
  const id = await insertCapture(inbox.id, properties, values, { title, kind: "link" });
  if (link.image) await attachCover(id, link.image);
  return { id };
}

// Compte des entrées à traiter, pour le repère de la sidebar.
export async function countInbox(): Promise<number> {
  const inbox = await getInbox();
  if (!inbox) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pages)
    .where(and(eq(pages.dbId, inbox.id), eq(pages.type, "entry"), isNull(pages.trashedAt)));
  return Number(row?.count ?? 0);
}

export type InboxRow = {
  id: string;
  title: string;
  kind: "link" | "note" | null;
  url: string | null;
  preview: string | null;
  source: string | null;
  createdAt: string;
};

// Entrées de l'Inbox, les plus récentes d'abord.
export async function listInboxRows(): Promise<InboxRow[]> {
  const inbox = await getInbox();
  if (!inbox) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      inboxKind: pages.inboxKind,
      propertyValues: pages.propertyValues,
      createdAt: pages.createdAt,
    })
    .from(pages)
    .where(and(eq(pages.dbId, inbox.id), eq(pages.type, "entry"), isNull(pages.trashedAt)))
    .orderBy(desc(pages.createdAt));
  const properties = parseConfig(inbox.dbConfig).properties;
  return rows.map((row) => {
    const values =
      typeof row.propertyValues === "object" && row.propertyValues !== null
        ? (row.propertyValues as Record<string, unknown>)
        : {};
    const text = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : null);
    const known = (propId: string) => properties.some((prop) => prop.id === propId);
    return {
      id: row.id,
      title: row.title,
      kind: row.inboxKind,
      url: known(INBOX_URL_PROP) ? text(INBOX_URL_PROP) : null,
      preview: known(INBOX_PREVIEW_PROP) ? text(INBOX_PREVIEW_PROP) : null,
      source: known(INBOX_SOURCE_PROP) ? text(INBOX_SOURCE_PROP) : null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
