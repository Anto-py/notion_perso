// Reprise d'une page d'une sauvegarde dans la base vive (palier d de l'étape
// 12) : lecture de la copie, plan pur (backup_restore_plan.ts), écriture en
// une transaction. Ce qui est écrit ici part vers le VPS au cycle suivant comme
// une modification neuve, et répare les deux côtés.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media, pages } from "@/db/schema";
import { backupDb } from "./backup_db";
import { backupMedia, backupPage, backupSubtree } from "./backup_read";
import { planRecovery, type LiveRef } from "./backup_restore_plan";
import { flattenToText } from "./blocks";
import { configOf } from "./databases";
import { newId } from "./ids";
import { getMedia } from "./pages";
import { normalizeValues, valuesToText, type Property } from "./properties";
import { promoteQuarantinedFile } from "./storage";

export type RecoveryResult = {
  // L'id final de la page reprise : le même si elle était encore là, un neuf
  // si elle avait disparu.
  pageId: string;
  recovered: number;
  trashedCopies: number;
  missingFiles: number;
};

export type RecoveryOutcome =
  | { ok: true; result: RecoveryResult }
  | { ok: false; status: 404 | 409; error: string };

// Les lignes de la base vive qui décident du plan : présence, rangement,
// corbeille. Le corps n'est pas lu ici, la transaction le relira pour les
// copies.
async function liveRefs(): Promise<Map<string, LiveRef>> {
  const rows = await db.select({ id: pages.id, parentId: pages.parentId, dbId: pages.dbId, trashedAt: pages.trashedAt }).from(pages);
  return new Map(
    rows.map((row) => [row.id, { parentId: row.parentId, dbId: row.dbId, trashed: row.trashedAt !== null }]),
  );
}

export async function recoverFromBackup(id: string, subtree: boolean): Promise<RecoveryOutcome> {
  if (!backupDb()) return { ok: false, status: 404, error: "Aucune sauvegarde ouverte" };
  const page = await backupPage(id);
  if (!page || page.trashedAt) return { ok: false, status: 404, error: "Page introuvable dans la sauvegarde" };

  const source = subtree ? await backupSubtree(id) : [page];
  const plan = planRecovery(source, await liveRefs(), newId);

  // Décision d'Antonin du 2026-11-01 : une entrée dont la base a disparu ne se
  // reprend pas seule, ses propriétés vivant dans le schéma de la base.
  if (plan.blockedBy) {
    const base = await backupPage(plan.blockedBy);
    const name = base ? ` « ${base.title || "Sans titre"} »` : "";
    return { ok: false, status: 409, error: `Récupérez d'abord sa base${name}.` };
  }

  // Médias : la copie sait le type et le nom d'origine, le disque sait la
  // taille. Un fichier introuvable ne bloque pas la page, il est compté.
  const mediaRows: (typeof media.$inferInsert)[] = [];
  const missing: string[] = [];
  for (const filename of plan.media) {
    if (await getMedia(filename)) continue;
    const known = await backupMedia(filename);
    if (!known) {
      missing.push(filename);
      continue;
    }
    const size = await promoteQuarantinedFile(filename);
    if (size === null) {
      missing.push(filename);
      continue;
    }
    mediaRows.push({ id: newId("md"), filename, originalName: known.originalName, mime: known.mime, size });
  }

  const now = new Date();
  const recovered = await db.transaction(async (tx) => {
    if (mediaRows.length) await tx.insert(media).values(mediaRows).onConflictDoNothing();

    // 1. L'état actuel de chaque page reprise encore présente, sous un id
    // neuf et en corbeille. Une base part sans ses entrées (SPECS).
    for (const copy of plan.copies) {
      const [row] = await tx.select().from(pages).where(eq(pages.id, copy.sourceId)).limit(1);
      if (!row) continue;
      await tx.insert(pages).values({
        id: copy.id,
        parentId: row.parentId,
        type: row.type,
        title: row.title,
        icon: row.icon,
        cover: row.cover,
        coverPosition: row.coverPosition,
        body: row.body,
        bodyText: row.bodyText,
        dbConfig: row.dbConfig,
        dbId: row.dbId,
        propertyValues: row.propertyValues,
        valuesText: row.valuesText,
        manualOrder: row.manualOrder,
        isInbox: row.isInbox,
        shareEnabled: row.shareEnabled,
        publicId: row.publicId,
        shareIncludeSubpages: row.shareIncludeSubpages,
        trashedAt: now,
      });
    }

    // 2. Les pages reprises, parents d'abord (le plan les a triées). Le schéma
    // de la base d'accueil se lit ici et non avant : une base reprise dans le
    // même geste n'existe qu'à partir de sa propre écriture, plus haut dans
    // cette boucle. Le cache évite une lecture par entrée.
    const propertiesOf = new Map<string, Property[]>();
    for (const planned of plan.pages) {
      const from = planned.source;
      let properties: Property[] = [];
      if (planned.dbId) {
        const cached = propertiesOf.get(planned.dbId);
        if (cached) properties = cached;
        else {
          const [base] = await tx.select({ dbConfig: pages.dbConfig }).from(pages).where(eq(pages.id, planned.dbId)).limit(1);
          properties = base ? configOf(base).properties : [];
          propertiesOf.set(planned.dbId, properties);
        }
      }
      const values = from.propertyValues === null ? null : normalizeValues(properties, from.propertyValues);
      const row = {
        title: from.title,
        icon: from.icon,
        cover: from.cover,
        coverPosition: from.coverPosition,
        body: planned.body,
        bodyText: flattenToText(planned.body),
        dbConfig: from.dbConfig,
        dbId: planned.dbId,
        propertyValues: from.propertyValues,
        valuesText: values ? valuesToText(properties, values) : "",
        manualOrder: from.manualOrder,
        parentId: planned.parentId,
        trashedAt: null,
        updatedAt: now,
      };
      const exists = await tx.select({ id: pages.id }).from(pages).where(eq(pages.id, planned.id)).limit(1);
      if (exists.length) {
        await tx.update(pages).set(row).where(eq(pages.id, planned.id));
      } else {
        await tx.insert(pages).values({ id: planned.id, type: from.type, createdAt: from.createdAt, ...row });
      }
    }

    return plan.pages.length;
  });

  return {
    ok: true,
    result: {
      pageId: plan.pages.find((planned) => planned.source.id === id)?.id ?? id,
      recovered,
      trashedCopies: plan.copies.length,
      missingFiles: missing.length,
    },
  };
}
