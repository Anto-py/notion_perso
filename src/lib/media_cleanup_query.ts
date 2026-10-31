// Nettoyage des médias (BRAINSTORMING §10, SPECS « Nettoyage des médias »).
// Deux chemins : le balayage, qui efface 30 jours après qu'un média a cessé de
// servir, et la purge manuelle, qui efface tout de suite les médias des pages
// purgées. Les deux passent par deleteUnused, qui revérifie dans la même
// instruction qu'aucune page ne cite plus le média, puis retire le fichier.
import { inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { planCleanup, STORED_NAME_IN_TEXT } from "./media_cleanup";
import { listTrash, purgeExpired, purgePage, trashedBatch, type Outcome } from "./pages";
import { removeFile } from "./storage";

const NAME_PATTERN = `(${STORED_NAME_IN_TEXT})`;

const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

// Noms cités quelque part, corbeille comprise : une page jetée peut revenir.
// Une image visible de la bibliothèque d'icônes sert même posée nulle part.
async function usedFilenames(): Promise<Set<string>> {
  const result = await db.execute<{ filename: string }>(sql`
    SELECT m[1] AS filename FROM pages, regexp_matches(body::text, ${NAME_PATTERN}, 'g') AS m
    UNION SELECT substring(icon FROM 7) FROM pages WHERE icon LIKE 'image:%'
    UNION SELECT substring(cover FROM 7) FROM pages WHERE cover LIKE 'image:%'
    UNION SELECT md.filename FROM icon_images i JOIN media md ON md.id = i.media_id WHERE NOT i.hidden`);
  return new Set(result.rows.map((row) => row.filename));
}

// Une citation apparue depuis la lecture (collage, restauration) garde le
// média. La cascade emporte une entrée icon_images retirée de la bibliothèque.
async function deleteUnused(which: SQL): Promise<number> {
  const removed = await db.execute<{ filename: string }>(sql`
    DELETE FROM media m
    WHERE ${which}
      AND NOT EXISTS (
        SELECT 1 FROM pages p
        WHERE strpos(p.body::text, m.filename) > 0
           OR p.icon = 'image:' || m.filename
           OR p.cover = 'image:' || m.filename)
      AND NOT EXISTS (SELECT 1 FROM icon_images i WHERE i.media_id = m.id AND NOT i.hidden)
    RETURNING m.filename`);
  for (const { filename } of removed.rows) {
    try {
      await removeFile(filename);
    } catch (error) {
      console.error(`Média ${filename} : ligne effacée, fichier non retiré :`, error);
    }
  }
  return removed.rows.length;
}

// Balayage. Renvoie le nombre de médias effacés.
export async function cleanMedia(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: media.id, filename: media.filename, unusedSince: media.unusedSince })
    .from(media);
  const plan = planCleanup(rows, await usedFilenames(), now);
  if (plan.mark.length) await db.update(media).set({ unusedSince: now }).where(inArray(media.id, plan.mark));
  if (plan.unmark.length) await db.update(media).set({ unusedSince: null }).where(inArray(media.id, plan.unmark));
  if (!plan.remove.length) return 0;
  const count = await deleteUnused(sql`m.id IN (${list(plan.remove.map((row) => row.id))})`);
  if (count) console.log(`Médias : ${count} fichier(s) inutilisé(s) depuis 30 jours effacé(s)`);
  return count;
}

// Aux appels qui ne doivent pas échouer pour autant (démarrage, corbeille).
export async function tryCleanMedia(): Promise<void> {
  try {
    await cleanMedia();
  } catch (error) {
    console.error("Nettoyage des médias impossible :", error);
  }
}

// Purge des éléments de plus de 30 jours puis balayage des médias, au
// démarrage et à l'ouverture de la corbeille. Un échec ne bloque ni l'un ni
// l'autre : la corbeille reste lisible, le miroir en lecture seule compris.
export async function tryPurgeExpired(): Promise<void> {
  try {
    const count = await purgeExpired();
    if (count) console.log(`Corbeille : ${count} élément(s) de plus de 30 jours purgé(s)`);
  } catch (error) {
    console.error("Purge de la corbeille impossible :", error);
  }
  await tryCleanMedia();
}

// Noms cités par le lot purgé avec rootId, entrées de ses bases comprises :
// la cascade de db_id emporte aussi celles jetées plus tôt, à part.
async function filenamesOfBatch(rootId: string): Promise<string[]> {
  const result = await db.execute<{ filename: string }>(sql`
    WITH lot AS (${trashedBatch(rootId)}),
    purged AS (
      SELECT body, icon, cover FROM pages
      WHERE id IN (SELECT id FROM lot) OR db_id IN (SELECT id FROM lot))
    SELECT m[1] AS filename FROM purged, regexp_matches(body::text, ${NAME_PATTERN}, 'g') AS m
    UNION SELECT substring(icon FROM 7) FROM purged WHERE icon LIKE 'image:%'
    UNION SELECT substring(cover FROM 7) FROM purged WHERE cover LIKE 'image:%'`);
  return result.rows.map((row) => row.filename);
}

// Purge manuelle d'un lot : ses médias qui ne servent plus ailleurs partent
// aussitôt. Un échec sur les médias n'annule pas la purge, déjà faite ; le
// balayage les reprendra.
export async function purgeWithMedia(id: string): Promise<Outcome> {
  const filenames = await filenamesOfBatch(id);
  const outcome = await purgePage(id);
  if (outcome.ok && filenames.length) {
    try {
      await deleteUnused(sql`m.filename IN (${list(filenames)})`);
    } catch (error) {
      console.error("Médias de la page purgée non effacés :", error);
    }
  }
  return outcome;
}

// Vider la corbeille : chaque lot, tête par tête. Une entrée déjà emportée
// avec sa base répond introuvable et se saute. Renvoie le nombre de lots purgés.
export async function emptyTrash(canPurge: (item: { id: string }) => boolean): Promise<number> {
  let purged = 0;
  for (const item of await listTrash()) {
    if (canPurge(item) && (await purgeWithMedia(item.id)).ok) purged += 1;
  }
  return purged;
}
