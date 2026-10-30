// Écriture d'un plan d'import : médias sur le disque, puis pages, entrées et
// lignes media en une seule transaction. En cas d'échec, les fichiers déjà
// écrits sont retirés : l'import ne laisse rien à moitié.
import { Readable } from "node:stream";
import { db } from "@/db";
import { media, pages } from "@/db/schema";
import type { ImportPlan } from "./notion-import";
import { removeFile, saveFile } from "./storage";

// PostgreSQL limite le nombre de paramètres d'une instruction ; cent lignes
// par INSERT restent loin du plafond.
const BATCH = 100;

export async function applyImportPlan(plan: ImportPlan): Promise<void> {
  const written: string[] = [];
  try {
    for (const item of plan.media) {
      // Un flux plutôt qu'un Blob : le type Uint8Array de Node ne s'accorde pas
      // avec BlobPart sous TypeScript strict.
      await saveFile(Readable.toWeb(Readable.from([item.bytes])) as ReadableStream<Uint8Array>, item.storedName);
      written.push(item.storedName);
    }

    const rows = plan.pages.map((page) => ({
      id: page.id,
      parentId: page.parentId,
      dbId: page.dbId,
      type: page.type,
      title: page.title,
      body: page.body,
      bodyText: page.bodyText,
      dbConfig: page.dbConfig,
      propertyValues: page.propertyValues,
      valuesText: page.valuesText,
      manualOrder: page.manualOrder,
    }));

    await db.transaction(async (tx) => {
      // L'ordre du plan place conteneur, pages (parents avant enfants), bases
      // puis entrées : chaque clé étrangère trouve sa ligne déjà écrite.
      for (let index = 0; index < rows.length; index += BATCH) {
        await tx.insert(pages).values(rows.slice(index, index + BATCH));
      }
      if (plan.media.length > 0) {
        await tx.insert(media).values(
          plan.media.map((item) => ({
            id: item.id,
            filename: item.storedName,
            originalName: item.originalName.slice(0, 255),
            mime: item.mime,
            size: item.size,
            pageId: item.pageId,
          })),
        );
      }
    });
  } catch (error) {
    await Promise.all(written.map((name) => removeFile(name).catch(() => undefined)));
    throw error;
  }
}
