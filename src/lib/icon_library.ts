// Bibliothèque des images d'icône (BRAINSTORMING §1 bis) : liste avec
// usage, ajout, renommage, retrait, suppression. Les règles pures (format,
// nom, plafond) sont dans icons.ts.
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { iconImages, media, pages } from "@/db/schema";
import { imageIcon } from "./icons";
import { newId } from "./ids";
import type { Outcome } from "./pages";
import { removeFile, saveFile } from "./storage";

export type IconImage = { id: string; filename: string; name: string; uses: number };

const NOT_FOUND: Outcome = { ok: false, status: 404, error: "Image introuvable" };

// Pages dont l'icône est ce fichier, corbeille comprise : une page jetée peut
// revenir, son icône doit l'attendre.
const usesOf = (filename: typeof media.filename) =>
  sql<number>`(SELECT count(*)::int FROM ${pages} WHERE ${pages.icon} = 'image:' || ${filename})`;

// Images non retirées, plus récentes d'abord.
export async function listIcons(): Promise<IconImage[]> {
  return db
    .select({ id: iconImages.id, filename: media.filename, name: iconImages.name, uses: usesOf(media.filename) })
    .from(iconImages)
    .innerJoin(media, eq(media.id, iconImages.mediaId))
    .where(eq(iconImages.hidden, false))
    .orderBy(desc(iconImages.createdAt));
}

// Une page ne prend pour icône qu'une image de la bibliothèque, retirée ou non.
export async function isLibraryFile(filename: string): Promise<boolean> {
  const [row] = await db
    .select({ id: iconImages.id })
    .from(iconImages)
    .innerJoin(media, eq(media.id, iconImages.mediaId))
    .where(eq(media.filename, filename))
    .limit(1);
  return Boolean(row);
}

// Le fichier est écrit d'abord ; si l'enregistrement échoue, il est retiré.
// Le média n'appartient à aucune page (page_id nul) : il est à la bibliothèque.
export async function addIcon(file: File, ext: string, name: string): Promise<IconImage> {
  const mediaId = newId("up");
  const filename = `${mediaId}.${ext}`;
  await saveFile(file.stream(), filename);
  const id = newId("ic");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(media).values({
        id: mediaId,
        filename,
        originalName: file.name.slice(0, 255) || filename,
        mime: file.type,
        size: file.size,
        pageId: null,
      });
      await tx.insert(iconImages).values({ id, mediaId, name });
    });
  } catch (error) {
    await removeFile(filename);
    throw error;
  }
  return { id, filename, name, uses: 0 };
}

export async function updateIcon(id: string, patch: { name?: string; hidden?: boolean }): Promise<Outcome> {
  const rows = await db.update(iconImages).set(patch).where(eq(iconImages.id, id)).returning({ id: iconImages.id });
  return rows.length ? { ok: true } : NOT_FOUND;
}

// Suppression réelle, seulement si aucune page ne l'utilise. La ligne est
// verrouillée le temps du compte ; la cascade emporte icon_images avec le
// média, puis le fichier quitte le disque une fois la transaction validée.
export async function deleteIcon(id: string): Promise<Outcome> {
  const outcome = await db.transaction(async (tx): Promise<Outcome & { filename?: string }> => {
    const [row] = await tx
      .select({ mediaId: iconImages.mediaId, filename: media.filename })
      .from(iconImages)
      .innerJoin(media, eq(media.id, iconImages.mediaId))
      .where(eq(iconImages.id, id))
      .for("update");
    if (!row) return NOT_FOUND;
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(pages)
      .where(eq(pages.icon, imageIcon(row.filename)));
    if (count > 0) {
      const what = count === 1 ? "une page : retirez-la de la bibliothèque, ou changez d'abord son icône" : `${count} pages : retirez-la de la bibliothèque, ou changez d'abord leur icône`;
      return { ok: false, status: 409, error: `Utilisée par ${what}.` };
    }
    await tx.delete(media).where(eq(media.id, row.mediaId));
    return { ok: true, filename: row.filename };
  });
  if (outcome.ok && outcome.filename) await removeFile(outcome.filename);
  return outcome.ok ? { ok: true } : outcome;
}
