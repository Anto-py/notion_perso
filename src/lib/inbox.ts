// Vide-cerveau : une page unique, à la racine de l'arbre, dont le corps est la
// file des captures. Une capture = un bloc ajouté en bas. Une ligne d'avant
// l'étape 18 porte encore une base : elle est convertie à la première visite,
// ses entrées abandonnées (décision d'Antonin du 2026-11-10).
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { CAPTURE_TITLE_MAX, mentionBlock, noteBlock } from "./capture";
import { newId } from "./ids";
import { runInboxPageMove } from "./inbox_page_move_query";
import { appendBlocks, type Page } from "./pages";
import { domainOf } from "./unfurl";

export const INBOX_TITLE = "Vide-cerveau";

export async function getInbox(): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.isInbox, true), isNull(pages.trashedAt)))
    .limit(1);
  return row ?? null;
}

// L'ancienne base perd ses entrées et devient la page, même id, même titre,
// même icône. Le rôle reste unique : l'index partiel n'est jamais contourné.
// Le plan et l'écriture vivent dans inbox_page_move_query.ts, partagés avec le
// démarrage et le script.
async function convertLegacyInbox(inbox: Page): Promise<Page> {
  if (inbox.type !== "database") return inbox;
  await runInboxPageMove(db, { write: true });
  return (await getInbox()) ?? inbox;
}

// Création paresseuse. ON CONFLICT DO NOTHING couvre l'index unique partiel :
// deux onglets ouverts en même temps ne créent pas deux Vide-cerveau.
export async function ensureInbox(): Promise<Page> {
  const existing = await getInbox();
  if (existing) return convertLegacyInbox(existing);
  const [created] = await db
    .insert(pages)
    .values({
      id: newId("pg"),
      type: "page",
      title: INBOX_TITLE,
      parentId: null,
      isInbox: true,
    })
    .onConflictDoNothing()
    .returning();
  const inbox = created ?? (await getInbox());
  if (!inbox) throw new Error("Vide-cerveau introuvable après création");
  return convertLegacyInbox(inbox);
}

// Une capture s'ajoute en bas, sous verrou (appendBlocks, partagé avec
// l'accès agent) : deux captures simultanées ne se perdent pas, et l'éditeur
// resté ouvert fusionne par bloc à son prochain enregistrement.
async function appendBlock(inboxId: string, block: unknown): Promise<string> {
  const outcome = await appendBlocks(inboxId, [block]);
  if (!outcome.ok) throw new Error(`Vide-cerveau : ${outcome.error}`);
  return inboxId;
}

export async function captureNote(text: string): Promise<{ id: string }> {
  const inbox = await ensureInbox();
  return { id: await appendBlock(inbox.id, noteBlock(text)) };
}

export type LinkCapture = { url: string; title?: string };

// Un lien capturé garde son adresse même sans métadonnées : le titre retombe
// sur le domaine. La mention ne porte que le favicon et le titre, lus à
// l'affichage et à la capture.
export async function captureLink(link: LinkCapture): Promise<{ id: string }> {
  const inbox = await ensureInbox();
  const title = (link.title?.trim() || domainOf(link.url)).slice(0, CAPTURE_TITLE_MAX);
  return { id: await appendBlock(inbox.id, mentionBlock(link.url, title)) };
}

// Compte des captures à traiter, pour le repère de la sidebar : un bloc de
// premier niveau = une capture, le corps de la page étant la file.
export async function countInbox(): Promise<number> {
  const inbox = await getInbox();
  if (!inbox) return 0;
  const [row] = await db
    .select({ count: sql<number>`coalesce(jsonb_array_length(${pages.body}), 0)` })
    .from(pages)
    .where(eq(pages.id, inbox.id));
  return Number(row?.count ?? 0);
}
