// Logos de la vitrine : cache disque et téléchargement (SPECS, « Rôle des
// fichiers clés », Vitrine, logos). Les règles pures sont dans vitrine_logo.ts ;
// l'appelant (la route) a déjà vérifié que l'hôte est celui d'une entrée.
//
// Un fichier par hôte dans UPLOAD_DIR/vitrine_logos/ : <host>.<ext> pour un
// logo, <host>.none (vide) pour une absence, relus après 30 jours. Ce dossier
// n'a pas de ligne dans la table media : le balayage des médias l'ignore.
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { uploadDir } from "./storage";
import { fetchPage, fetchRemoteImage, type RemoteImage } from "./unfurl_fetch";
import { LOGO_DIR, LOGO_NONE, LOGO_TYPES, logoCandidates, logoFresh } from "./vitrine_logo";

export type Logo = { bytes: Uint8Array; mime: string };

const EXTENSIONS = [...Object.keys(LOGO_TYPES), LOGO_NONE];
// Chaque candidat peut attendre six secondes : quatre essais au plus, le
// dernier toujours /favicon.ico.
const MAX_TRIES = 4;

// Un seul téléchargement en vol par hôte, cache relu compris (une page de 400
// cartes demande ses logos d'un coup). Sur globalThis, comme le limiteur :
// le serveur de développement peut charger le module deux fois.
const inflight: Map<string, Promise<Logo | null>> = ((globalThis as { __vitrineLogos?: Map<string, Promise<Logo | null>> }).__vitrineLogos ??= new Map());

function logoDir(): string {
  return path.join(/*turbopackIgnore: true*/ uploadDir(), LOGO_DIR);
}

function fileOf(host: string, ext: string): string {
  return path.join(/*turbopackIgnore: true*/ logoDir(), `${host}.${ext}`);
}

type Cached = { ext: string; mtimeMs: number };

async function cached(host: string): Promise<Cached | null> {
  const found = await Promise.all(EXTENSIONS.map((ext) => stat(fileOf(host, ext)).then((info) => (info.isFile() ? { ext, mtimeMs: info.mtimeMs } : null), () => null)));
  return found.find((item) => item !== null) ?? null;
}

async function read(host: string, ext: string): Promise<Logo> {
  return { bytes: new Uint8Array(await readFile(fileOf(host, ext))), mime: LOGO_TYPES[ext] };
}

// Écrit à côté puis renomme : un lecteur ne voit jamais un fichier à moitié
// écrit. Les autres formats du même hôte (ancien logo, absence) partent.
async function store(host: string, ext: string, bytes: Uint8Array): Promise<void> {
  await mkdir(logoDir(), { recursive: true });
  const temp = path.join(/*turbopackIgnore: true*/ logoDir(), `.${host}.${randomUUID()}.tmp`);
  await writeFile(temp, bytes);
  await rename(temp, fileOf(host, ext));
  await Promise.all(EXTENSIONS.filter((other) => other !== ext).map((other) => rm(fileOf(host, other), { force: true })));
}

async function download(target: string): Promise<RemoteImage | null> {
  const page = await fetchPage(target);
  const all = page?.html ? logoCandidates(page.html, page.url) : [new URL("/favicon.ico", page?.url ?? target).toString()];
  const tries = all.length > MAX_TRIES ? [...all.slice(0, MAX_TRIES - 1), all[all.length - 1]] : all;
  for (const url of tries) {
    const image = await fetchRemoteImage(url, { allowIcon: true });
    if (image) return image;
  }
  return null;
}

async function resolve(host: string, target: string): Promise<Logo | null> {
  const now = Date.now();
  const found = await cached(host);
  if (found && logoFresh(found.mtimeMs, now)) return found.ext === LOGO_NONE ? null : read(host, found.ext);

  const image = await download(target);
  if (image) {
    await store(host, image.ext, image.bytes);
    return { bytes: image.bytes, mime: LOGO_TYPES[image.ext] ?? image.mime };
  }
  // Site en panne le jour de la relecture : l'ancien logo reste, relu dans
  // 30 jours.
  if (found && found.ext !== LOGO_NONE) {
    await utimes(fileOf(host, found.ext), new Date(now), new Date(now));
    return read(host, found.ext);
  }
  await store(host, LOGO_NONE, new Uint8Array());
  return null;
}

// Logo de l'hôte, null s'il n'en a pas. target : page d'accueil du site
// (logoTarget), lue seulement quand le cache manque ou a vieilli.
export function vitrineLogo(host: string, target: string): Promise<Logo | null> {
  let pending = inflight.get(host);
  if (!pending) {
    pending = resolve(host, target).finally(() => inflight.delete(host));
    inflight.set(host, pending);
  }
  return pending;
}
