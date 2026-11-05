// Écriture d'un plan d'import : médias sur le disque, puis pages, entrées et
// lignes media en une seule transaction. En cas d'échec, les fichiers déjà
// écrits sont retirés : l'import ne laisse rien à moitié.
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { iconImages, media, pages } from "@/db/schema";
import { BASES_ROOT_ID } from "./bases";
import type { ImportPlan } from "./notion-import";
import { compareKeys, keyBetween, keyFromIndex } from "./order_key";
import { discardFile, saveFile } from "./storage";

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
      icon: page.icon,
      cover: page.cover,
      coverPosition: page.coverPosition,
      body: page.body,
      bodyText: page.bodyText,
      dbConfig: page.dbConfig,
      propertyValues: page.propertyValues,
      valuesText: page.valuesText,
      manualOrder: keyFromIndex(page.manualOrder),
    }));

    await db.transaction(async (tx) => {
      // Le dossier d'import arrive après ce que « Bases » range déjà.
      const inBases = rows.filter((row) => row.parentId === BASES_ROOT_ID);
      if (inBases.length > 0) {
        const siblings = await tx.select({ key: pages.manualOrder }).from(pages).where(eq(pages.parentId, BASES_ROOT_ID));
        let last = siblings.map((row) => row.key).sort(compareKeys).at(-1) ?? null;
        for (const row of inBases) row.manualOrder = last = keyBetween(last, null);
      }
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
      // Les images d'icône de l'archive rejoignent la bibliothèque : leur média
      // est déjà écrit ci-dessus (pageId nul), la page pointe par
      // « image:<filename> ».
      if (plan.icons.length > 0) {
        await tx.insert(iconImages).values(
          plan.icons.map((icon) => ({ id: icon.id, mediaId: icon.mediaId, name: icon.name.slice(0, 100) })),
        );
      }
    });
  } catch (error) {
    await Promise.all(written.map((name) => discardFile(name).catch(() => undefined)));
    throw error;
  }
}
