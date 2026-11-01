// Écriture et lecture des fichiers déposés, sur le disque du serveur (volume
// Coolify en production). Les règles d'admission sont dans upload_rules.ts.
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { quarantineExpired } from "./backup_rules";
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

// Quarantaine des médias, sur le Mac seulement (QUARANTINE_DIR, posée par le
// lanceur, hors des fichiers servis) : un dump ne contient pas les fichiers,
// une page reprise d'une sauvegarde y retrouve ses images. Absente (VPS,
// développement) : effacement direct.
export function quarantineDir(): string | null {
  const dir = process.env.QUARANTINE_DIR;
  return dir ? path.resolve(/*turbopackIgnore: true*/ dir) : null;
}

// Retrait d'un fichier dont le média n'existe plus : une image d'icône
// supprimée de la bibliothèque (lib/icon_library.ts), un média inutilisé
// depuis 30 jours (lib/media_cleanup_query.ts), un média effacé par la
// synchronisation (lib/sync_client.ts). En quarantaine quand elle existe,
// datée de son entrée (rename garde l'ancienne date de modification).
export async function removeFile(filename: string): Promise<void> {
  const source = storedPath(filename);
  const quarantine = quarantineDir();
  if (!quarantine) {
    await rm(source, { force: true });
    return;
  }
  const target = path.join(/*turbopackIgnore: true*/ quarantine, filename);
  await mkdir(quarantine, { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    // Autre volume que uploads/ : copie puis effacement.
    if (code !== "EXDEV") throw error;
    await copyFile(source, target);
    await rm(source, { force: true });
  }
  const now = new Date();
  await utimes(target, now, now);
}

// Effacement sans quarantaine, pour un fichier qui n'a jamais été bon : reçu
// incomplet, ou écrit par un import qui échoue (lib/import_write.ts).
export async function discardFile(filename: string): Promise<void> {
  await rm(storedPath(filename), { force: true });
}

// Ramène en service un fichier parti en quarantaine, pour une page reprise
// d'une sauvegarde. Déjà dans uploads/ : rien à faire. Rend sa taille, ou null
// s'il n'est nulle part.
export async function promoteQuarantinedFile(filename: string): Promise<number | null> {
  if (!isStoredName(filename)) return null;
  const target = storedPath(filename);
  const present = await stat(target).catch(() => null);
  if (present?.isFile()) return present.size;

  const quarantine = quarantineDir();
  if (!quarantine) return null;
  const source = path.join(/*turbopackIgnore: true*/ quarantine, filename);
  await mkdir(uploadDir(), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") return null;
    await copyFile(source, target);
    await rm(source, { force: true });
  }
  const info = await stat(target).catch(() => null);
  return info?.isFile() ? info.size : null;
}

// Vide la quarantaine des fichiers de plus de 30 jours (instrumentation.ts,
// au démarrage). Rend le nombre de fichiers effacés.
export async function purgeQuarantine(now = Date.now()): Promise<number> {
  const quarantine = quarantineDir();
  if (!quarantine) return 0;
  const names = await readdir(quarantine).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (!isStoredName(name)) continue;
    const target = path.join(/*turbopackIgnore: true*/ quarantine, name);
    const { mtimeMs } = await stat(target);
    if (!quarantineExpired(mtimeMs, now)) continue;
    await rm(target, { force: true });
    removed++;
  }
  return removed;
}

// Taille du fichier sur le disque, null s'il n'y est pas.
export async function fileSize(filename: string): Promise<number | null> {
  try {
    return (await stat(storedPath(filename))).size;
  } catch {
    return null;
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

// Un média d'une sauvegarde n'est pas dans le dump : il vit dans uploads/,
// ou en quarantaine si la synchronisation l'a effacé depuis (palier d).
export async function openQuarantinedFile(
  filename: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const quarantine = quarantineDir();
  if (!quarantine || !isStoredName(filename)) return null;
  const target = path.join(/*turbopackIgnore: true*/ quarantine, filename);
  try {
    const { size } = await stat(target);
    const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    return { stream, size };
  } catch {
    return null;
  }
}
