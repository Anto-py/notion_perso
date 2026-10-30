// Lecture d'un export Notion « Markdown & CSV » : dézippage (le zip téléchargé
// contient souvent un second zip, découpé en Part-N), nommage « Titre <32 hex> »
// et appariement page / dossier jumeau / CSV de base. Module pur : aucune base,
// aucun disque, testable sur des archives fabriquées.
import { unzipSync } from "fflate";

export type ArchiveEntry = { path: string; bytes: Uint8Array };

export type NotionItem = {
  path: string; // chemin POSIX dans l'archive
  dir: string; // dossier parent, "" à la racine
  base: string; // nom de fichier sans extension
  ext: string; // extension en minuscules
  title: string; // nom sans le suffixe d'identifiant
  notionId: string; // 32 hexadécimaux ou UUID, "" si absent
  all: boolean; // suffixe _all d'un CSV complet
};

export type NotionArchive = {
  pages: NotionItem[]; // .md ordinaires, hors dossier de base
  databases: NotionItem[]; // un CSV par base, le _all de préférence
  entries: NotionItem[]; // .md d'une ligne de base
  stubs: NotionItem[]; // .md qui décrit une base (même identifiant que le CSV)
  media: NotionItem[]; // images et PDF servables
  others: NotionItem[]; // fichiers laissés de côté
  warnings: string[];
  htmlOnly: boolean; // export HTML : non pris en charge
  rootPages: NotionItem[]; // .md sans parent (plusieurs = export complet)
};

export class NotionImportError extends Error {}

// Extensions que /api/media sait servir ; l'extension du nom de fichier fait
// foi, comme pour l'upload (le type MIME n'existe pas dans un zip).
export const MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "pdf"]);

const MAX_ZIP_DEPTH = 3;

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function parentDir(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function stripExtension(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? path : path.slice(0, cut);
}

// « Veille 0123…cdef » → titre « Veille », identifiant, et drapeau _all.
export function splitNotionName(base: string): { title: string; notionId: string; all: boolean } {
  const match = /\s([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(_all)?$/i.exec(base);
  if (!match) return { title: base.trim(), notionId: "", all: false };
  const title = base.slice(0, match.index).trim();
  return { title: title || base.trim(), notionId: match[1].toLowerCase(), all: Boolean(match[2]) };
}

function toItem(path: string): NotionItem {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  const stem = dot === -1 ? base : base.slice(0, dot);
  return { path, dir: parentDir(path), base: stem, ext, ...splitNotionName(stem) };
}

// Un chemin d'archive sans dossier, sans traversée (« ../ ») ni résidu macOS.
function safePath(raw: string, warnings: string[]): string | null {
  const path = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path === "" || path.endsWith("/")) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "..")) {
    warnings.push(`Chemin ignoré : ${raw}`);
    return null;
  }
  if (parts[0] === "__MACOSX" || parts[parts.length - 1] === ".DS_Store") return null;
  return path;
}

function unpackLevel(bytes: Uint8Array, depth: number, files: ArchiveEntry[], warnings: string[]): void {
  if (depth > MAX_ZIP_DEPTH) {
    warnings.push("Archive imbriquée au-delà de trois niveaux : le reste est ignoré.");
    return;
  }
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new NotionImportError("Archive illisible : ce fichier n'est pas un zip valide.");
  }
  const nested: Uint8Array[] = [];
  for (const [raw, data] of Object.entries(unzipped)) {
    const path = safePath(raw, warnings);
    if (!path) continue;
    if (/\.zip$/i.test(path)) {
      nested.push(data);
      continue;
    }
    files.push({ path, bytes: data });
  }
  // Le zip livré par Notion contient le vrai export ; un export massif arrive
  // en plusieurs Part-N.zip, dézippés ici à la suite.
  for (const data of nested) unpackLevel(data, depth + 1, files, warnings);
}

export function unpackZip(bytes: Uint8Array): { files: ArchiveEntry[]; warnings: string[] } {
  const files: ArchiveEntry[] = [];
  const warnings: string[] = [];
  unpackLevel(bytes, 0, files, warnings);
  return { files, warnings };
}

function isUnder(path: string, dir: string): boolean {
  return dir !== "" && path.startsWith(`${dir}/`);
}

export function indexArchive(files: ArchiveEntry[], warnings: string[] = []): NotionArchive {
  const items = files.map((file) => toItem(file.path));
  const markdown = items.filter((item) => item.ext === "md");
  const html = items.filter((item) => item.ext === "html");
  const csvs = items.filter((item) => item.ext === "csv");
  const media = items.filter((item) => MEDIA_EXTENSIONS.has(item.ext));
  const others: NotionItem[] = [];

  // Une seule ligne par base : le CSV complet (_all) l'emporte sur celui d'une
  // vue filtrée. La clé est le dossier d'accueil et l'identifiant.
  const byDatabase = new Map<string, NotionItem>();
  for (const csv of csvs) {
    const folder = csv.base.replace(/_all$/i, "");
    const key = joinPath(csv.dir, csv.notionId || folder);
    const kept = byDatabase.get(key);
    if (!kept) byDatabase.set(key, csv);
    else if (csv.all && !kept.all) byDatabase.set(key, csv);
  }
  const databases = [...byDatabase.values()];
  for (const csv of csvs) {
    if (!databases.includes(csv)) {
      warnings.push(`« ${csv.path} » ignoré : un CSV complet existe pour la même base.`);
    }
  }

  // Deux formes de dossier d'entrées coexistent dans les exports : celle qui
  // porte l'identifiant (« Base <id> ») et, quand la base est une page du même
  // nom, celle qui ne porte que le titre (« Base »). Sans la seconde, les
  // corps des entrées deviennent des pages en double.
  const dbDirs = new Map<string, NotionItem>();
  const dbEntryDirs = new Map<string, NotionItem>();
  for (const db of databases) {
    const byId = joinPath(db.dir, db.base.replace(/_all$/i, ""));
    dbDirs.set(byId, db);
    dbEntryDirs.set(byId, db);
    if (db.title) dbEntryDirs.set(joinPath(db.dir, db.title), db);
  }

  const pages: NotionItem[] = [];
  const entries: NotionItem[] = [];
  const stubs: NotionItem[] = [];
  for (const md of markdown) {
    if (dbEntryDirs.has(md.dir)) {
      entries.push(md);
      continue;
    }
    if (dbDirs.has(stripExtension(md.path))) {
      stubs.push(md);
      continue;
    }
    if ([...dbEntryDirs.keys()].some((dir) => isUnder(md.path, dir))) {
      others.push(md);
      warnings.push(`« ${md.path} » ignoré : une sous-page d'entrée de base n'a pas d'équivalent ici.`);
      continue;
    }
    pages.push(md);
  }

  for (const item of items) {
    if (item.ext === "md" || item.ext === "csv") continue;
    if (item.ext === "html") continue;
    if (MEDIA_EXTENSIONS.has(item.ext)) continue;
    others.push(item);
  }

  const rootPages = pages.filter((page) => page.dir === "");
  return {
    pages,
    databases,
    entries,
    stubs,
    media,
    others,
    warnings,
    htmlOnly: markdown.length === 0 && html.length > 0,
    rootPages,
  };
}
