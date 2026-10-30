// Écriture et lecture des fichiers déposés, sur le disque du serveur (volume
// Coolify en production). Les règles d'admission sont dans upload_rules.ts.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { isStoredName } from "./upload_rules";

// Dossier lu à l'exécution (volume monté en production). Le commentaire
// turbopackIgnore empêche le build d'embarquer tout le projet dans l'image
// serveur, faute de pouvoir borner ce chemin (avertissement mesuré au build).
export function uploadDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
}

function storedPath(filename: string): string {
  if (!isStoredName(filename)) throw new Error(`Nom de fichier refusé : ${filename}`);
  return path.join(/*turbopackIgnore: true*/ uploadDir(), filename);
}

// Écrit en flux vers le disque, sans recopier le fichier dans un tampon de
// plus (formData() l'a déjà reçu en mémoire). Un fichier à moitié écrit
// (disque plein, coupure) est retiré.
export async function saveFile(source: ReadableStream<Uint8Array>, filename: string): Promise<void> {
  const target = storedPath(filename);
  await mkdir(uploadDir(), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(source as WebReadableStream<Uint8Array>), createWriteStream(target, { flags: "wx" }));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

export async function openFile(filename: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const target = storedPath(filename);
  try {
    const { size } = await stat(target);
    const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    return { stream, size };
  } catch {
    return null;
  }
}
