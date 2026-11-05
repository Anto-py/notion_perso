// Import d'un export Notion « Markdown & CSV » ou « HTML » : de l'archive au
// plan d'écriture. Module pur (aucune base, aucun disque) : il rend des pages
// prêtes à insérer, leurs médias et un rapport. L'écriture vit dans
// lib/import_write.ts.
import type { PageKind } from "./bases";
import { createHash } from "node:crypto";
import { flattenToText } from "./blocks";
import { newId as defaultNewId } from "./ids";
import {
  indexArchive,
  joinPath,
  NotionImportError,
  parentDir,
  stripExtension,
  unpackZip,
  type NotionItem,
} from "./notion-archive";
import { buildCsvDatabase, parseCsv } from "./notion-csv";
import { htmlToPage, type HtmlPage } from "./notion-html";
import { markdownToBlocks, type Block } from "./notion-markdown";
import { fold, valuesToText, type Values } from "./properties";
import type { DbConfig } from "./views";
import { ALLOWED_TYPES } from "./upload_rules";

export { NotionImportError } from "./notion-archive";

// Le zip peut dépasser la limite de 10 Mo du proxy : la route d'import en est
// exclue et vérifie elle-même la session (comme api/upload). Un export complet
// de Notion pèse couramment plusieurs centaines de Mo (334 Mo mesurés le
// 2026-10-30) : la limite laisse passer cet ordre de grandeur, au prix de la
// mémoire (zip, archive décompressée et médias vivent ensemble le temps du
// plan, soit environ trois fois la taille du zip).
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
export const CONTAINER_TITLE = "Import Notion";

const MEDIA_BY_EXT: Record<string, { mime: string; ext: string }> = {};
for (const [mime, ext] of Object.entries(ALLOWED_TYPES)) MEDIA_BY_EXT[ext] = { mime, ext };
MEDIA_BY_EXT.jpeg = { mime: "image/jpeg", ext: "jpg" };

const NOTION_URL_ID =
  /(?:[-\/])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i;

export type ImportCounts = { pages: number; databases: number; entries: number; media: number };
export type ImportNote = { reason: string; count: number };

export type ImportReport = {
  rootId: string;
  rootTitle: string;
  counts: ImportCounts;
  ignored: ImportNote[];
  notes: ImportNote[];
};

export type PlanMedia = {
  id: string;
  storedName: string;
  originalName: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
  // Page qui porte le média ; null pour une image de la bibliothèque d'icônes.
  pageId: string | null;
};

// Une image d'icône rangée en bibliothèque : le média est partagé par toutes
// les pages qui portent la même image (une seule fois par contenu).
export type PlanIcon = { id: string; mediaId: string; name: string };

export type PlanPage = {
  id: string;
  parentId: string | null;
  dbId: string | null;
  type: PageKind;
  title: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number | null;
  body: Block[];
  bodyText: string;
  dbConfig: DbConfig | null;
  propertyValues: Values | null;
  valuesText: string;
  // Rang parmi les frères, converti en clé d'ordre à l'écriture (import_write).
  manualOrder: number;
};

// Une image distante laissée à rapatrier par l'hydratation (import_remote.ts) :
// le plan reste pur, le réseau vient après.
export type RemoteAsset = {
  url: string;
  kind: "cover" | "image" | "icon";
  pageId: string;
  blockId?: string;
  // Prop du bloc à réécrire : « url » pour une image, « favicon » ou « image »
  // d'un signet.
  prop?: "url" | "favicon" | "image";
};

export type ImportPlan = {
  rootId: string;
  pages: PlanPage[];
  media: PlanMedia[];
  icons: PlanIcon[];
  remotes: RemoteAsset[];
  report: ImportReport;
};

export type ImportOptions = { newId?: (prefix: string) => string; newBlockId?: () => string };

// dbId et dbTitle ne sont posés que pour une entrée : un lien de CSV s'en sert
// pour reconnaître une relation vers des entrées d'une même base.
type Target = { id: string; kind: "page" | "database"; title: string; dbId?: string; dbTitle?: string };

function count(map: Map<string, number>, reason: string, amount = 1): void {
  map.set(reason, (map.get(reason) ?? 0) + amount);
}

function notes(map: Map<string, number>): ImportNote[] {
  return [...map.entries()].map(([reason, amount]) => ({ reason, count: amount }));
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Chemin d'une cible de lien, relatif au fichier qui le porte.
export function resolveArchivePath(fromPath: string, href: string): string {
  const clean = safeDecode(href.split("#")[0]);
  if (clean.startsWith("/")) return clean.slice(1);
  const segments = `${parentDir(fromPath)}/${clean}`.split("/");
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === "..") parts.pop();
    else if (segment !== "." && segment !== "") parts.push(segment);
  }
  return parts.join("/");
}

export function buildImportPlan(bytes: Uint8Array, options: ImportOptions = {}): ImportPlan {
  const makeId = options.newId ?? defaultNewId;
  const newBlockId = options.newBlockId ?? (() => globalThis.crypto.randomUUID());
  const { files, warnings } = unpackZip(bytes);
  const archive = indexArchive(files, warnings);
  if (archive.pages.length === 0 && archive.databases.length === 0 && archive.stubs.length === 0) {
    throw new NotionImportError("Aucune page ni base dans l'archive : vérifiez l'export Notion.");
  }

  // Le format majoritaire décide du lecteur ; les pages de l'autre format sont
  // comptées au rapport (BRAINSTORMING §8). Les CSV de base sont communs.
  const format = archive.format;
  const pageExt = format === "html" ? "html" : "md";
  const docPages = archive.pages.filter((page) => page.ext === pageExt);
  const docEntries = archive.entries.filter((entry) => entry.ext === pageExt);
  if (docPages.length === 0 && docEntries.length === 0 && archive.databases.length === 0) {
    throw new NotionImportError(
      format === "html"
        ? "Aucune page HTML lisible dans l'archive : vérifiez l'export Notion."
        : "Aucune page Markdown lisible dans l'archive : vérifiez l'export Notion.",
    );
  }

  const contentByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const ignored = new Map<string, number>();
  const converted = new Map<string, number>();
  for (const warning of archive.warnings) count(ignored, warning);
  if (archive.others.length > 0) count(ignored, "fichier non pris en charge", archive.others.length);
  if (archive.otherFormatPages > 0) count(ignored, "page d'un autre format ignorée", archive.otherFormatPages);

  // Identifiants tirés avant toute lecture : les médias et les liens ont besoin
  // des adresses finales, et l'écriture ne doit rien décider.
  const pageIds = new Map(docPages.map((page) => [page.path, makeId("pg")]));
  const databaseIds = new Map(archive.databases.map((db) => [db.path, makeId("pg")]));
  const entryIds = new Map(docEntries.map((entry) => [entry.path, makeId("pg")]));

  const targetByKey = new Map<string, Target>();
  const targetByNotionId = new Map<string, Target>();
  const remember = (key: string, target: Target, notionId: string) => {
    targetByKey.set(key, target);
    if (notionId) targetByNotionId.set(notionId, target);
  };
  for (const page of docPages) {
    remember(stripExtension(page.path), { id: pageIds.get(page.path)!, kind: "page", title: page.title }, page.notionId);
  }
  // Le CSV complet (_all) et le stub .md de la même base partagent le dossier
  // « Base <id> », qui est la clé commune des liens.
  const dbFolder = (db: NotionItem) => joinPath(db.dir, db.base.replace(/_all$/i, ""));
  // Le dossier des entrées porte l'identifiant de la base, ou son seul titre
  // quand la base est une page du même nom (voir indexArchive).
  const entryDirsOf = (db: NotionItem): string[] => {
    const dirs = [dbFolder(db)];
    if (db.title) dirs.push(joinPath(db.dir, db.title));
    return dirs;
  };
  for (const db of archive.databases) {
    remember(dbFolder(db), { id: databaseIds.get(db.path)!, kind: "database", title: db.title }, db.notionId);
  }
  // La base de chaque entrée, connue avant la lecture des CSV : une colonne de
  // liens ne devient une relation que si toutes ses cibles partagent la même.
  const entryBase = new Map<string, { id: string; title: string }>();
  for (const db of archive.databases) {
    const base = { id: databaseIds.get(db.path)!, title: db.title };
    const dirs = new Set(entryDirsOf(db));
    for (const entry of docEntries) {
      if (dirs.has(entry.dir)) entryBase.set(entry.path, base);
    }
  }
  for (const entry of docEntries) {
    const base = entryBase.get(entry.path);
    remember(
      stripExtension(entry.path),
      { id: entryIds.get(entry.path)!, kind: "page", title: entry.title, dbId: base?.id, dbTitle: base?.title },
      entry.notionId,
    );
  }

  const mediaByPath = new Map<string, PlanMedia>();
  function mediaUrl(ownerId: string | null, fromPath: string, href: string): string | null {
    const path = resolveArchivePath(fromPath, href);
    const data = contentByPath.get(path);
    if (!data) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const type = MEDIA_BY_EXT[ext];
    if (!type) return null;
    let media = mediaByPath.get(path);
    if (!media) {
      const id = makeId("up");
      media = {
        id,
        storedName: `${id}.${type.ext}`,
        originalName: path.slice(path.lastIndexOf("/") + 1),
        mime: type.mime,
        size: data.length,
        bytes: data,
        pageId: ownerId,
      };
      mediaByPath.set(path, media);
    }
    return `/api/media/${media.storedName}`;
  }

  function resolveLink(fromPath: string, href: string) {
    const notion = NOTION_URL_ID.exec(href);
    if (notion) {
      const target = targetByNotionId.get(notion[1].toLowerCase());
      if (!target) return null;
      return {
        href: target.kind === "database" ? `/db/${target.id}` : `/page/${target.id}`,
        pageId: target.id,
        kind: target.kind,
      };
    }
    if (/^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#")) return null;
    const path = resolveArchivePath(fromPath, href);
    const target = targetByKey.get(stripExtension(path)) ?? targetByKey.get(path);
    if (!target) return null;
    return {
      href: target.kind === "database" ? `/db/${target.id}` : `/page/${target.id}`,
      pageId: target.id,
      kind: target.kind,
    };
  }

  // Bases rangées par dossier : le tableau de collection d'une page se relie au
  // CSV de son dossier. Une page peut aussi porter ses enfants dans un dossier
  // de même titre, où vit le CSV de la base (export HTML).
  const databasesByDir = new Map<string, NotionItem[]>();
  for (const db of archive.databases) {
    databasesByDir.set(db.dir, [...(databasesByDir.get(db.dir) ?? []), db]);
  }
  function collectionFor(item: NotionItem, title: string): string | null {
    const dirs = [item.dir];
    const childDir = joinPath(item.dir, item.title);
    if (childDir !== item.dir) dirs.push(childDir);
    const candidates = dirs.flatMap((dir) => databasesByDir.get(dir) ?? []);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return databaseIds.get(candidates[0].path)!;
    const key = fold(title);
    const found = key ? candidates.find((db) => fold(db.title) === key) : undefined;
    return found ? databaseIds.get(found.path)! : null;
  }

  // Une image d'icône rejoint la bibliothèque, une seule fois par contenu.
  const iconMedia = new Map<string, { media: PlanMedia; icon: PlanIcon }>();
  function iconImage(ownerPath: string, iconPath: string): string | null {
    const path = resolveArchivePath(ownerPath, iconPath);
    const data = contentByPath.get(path);
    if (!data) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const type = MEDIA_BY_EXT[ext];
    if (!type) return null;
    const hash = createHash("sha256").update(data).digest("base64url");
    const known = iconMedia.get(hash);
    if (known) return `image:${known.media.storedName}`;
    const id = makeId("up");
    const media: PlanMedia = {
      id,
      storedName: `${id}.${type.ext}`,
      originalName: path.slice(path.lastIndexOf("/") + 1),
      mime: type.mime,
      size: data.length,
      bytes: data,
      pageId: null,
    };
    const name = (path.slice(path.lastIndexOf("/") + 1) || "icone").slice(0, 100);
    const icon: PlanIcon = { id: makeId("ic"), mediaId: id, name };
    iconMedia.set(hash, { media, icon });
    return `image:${media.storedName}`;
  }

  const parsedHtml = new Map<string, HtmlPage>();
  function readHtml(item: NotionItem, ownerId: string): HtmlPage {
    const known = parsedHtml.get(item.path);
    if (known) return known;
    const data = contentByPath.get(item.path);
    const page = htmlToPage(data ? decode(data) : "", {
      newBlockId,
      pageId: ownerId,
      resolveLink: (href) => resolveLink(item.path, href),
      resolveMedia: (src) => mediaUrl(ownerId, item.path, src),
      resolveCollection: (title) => collectionFor(item, title),
      onIgnored: (reason) => count(ignored, reason),
      onConverted: (reason) => count(converted, reason),
    });
    parsedHtml.set(item.path, page);
    return page;
  }

  function titleOf(item: NotionItem, ownerId: string): string {
    if (item.ext !== "html") return item.title;
    return readHtml(item, ownerId).title || item.title;
  }

  // Icône et bandeau d'une page HTML : l'icône est une image de bibliothèque,
  // le bandeau appartient à la page et porte son cadrage. Ce qui vient d'une
  // adresse distante est laissé au rapatriement (import_remote.ts).
  const remotes: RemoteAsset[] = [];
  function decorationOf(item: NotionItem, ownerId: string): Pick<PlanPage, "icon" | "cover" | "coverPosition"> {
    if (item.ext !== "html") return { icon: null, cover: null, coverPosition: null };
    const page = readHtml(item, ownerId);
    for (const remote of page.remoteImages) {
      remotes.push({ kind: "image", url: remote.url, pageId: ownerId, blockId: remote.blockId, prop: remote.prop });
    }
    let icon: string | null = null;
    if (page.icon?.kind === "emoji") {
      icon = Array.from(page.icon.emoji).length <= 16 ? page.icon.emoji : null;
      if (!icon) count(ignored, "icône emoji hors limites");
    } else if (page.icon?.kind === "image") {
      if (/^https?:\/\//i.test(page.icon.path)) {
        remotes.push({ kind: "icon", url: page.icon.path, pageId: ownerId });
      } else {
        icon = iconImage(item.path, page.icon.path);
        if (!icon) count(ignored, "icône absente de l'archive");
      }
    }
    let cover: string | null = null;
    if (page.coverPath) {
      if (/^https?:\/\//i.test(page.coverPath)) {
        remotes.push({ kind: "cover", url: page.coverPath, pageId: ownerId });
      } else {
        const url = mediaUrl(ownerId, item.path, page.coverPath);
        if (url) cover = `image:${url.slice(url.lastIndexOf("/") + 1)}`;
        else count(ignored, "bandeau absent de l'archive");
      }
    }
    return { icon, cover, coverPosition: page.coverPath ? page.coverPosition : null };
  }

  function markdownBlocks(fromPath: string, ownerId: string, markdown: string): Block[] {
    return markdownToBlocks(markdown, {
      newBlockId,
      resolveLink: (href) => resolveLink(fromPath, href),
      resolveMedia: (href) => mediaUrl(ownerId, fromPath, href),
      onIgnored: (reason) => count(ignored, reason),
      onConverted: (reason) => count(converted, reason),
    }).blocks;
  }

  function blocksOf(entry: NotionItem, ownerId: string, extra = ""): Block[] {
    if (entry.ext === "html") {
      const blocks = readHtml(entry, ownerId).blocks;
      if (extra) blocks.push(...markdownBlocks(entry.path, ownerId, extra));
      return blocks;
    }
    const data = contentByPath.get(entry.path);
    if (!data) return [];
    const markdown = extra ? `${decode(data)}\n\n${extra}` : decode(data);
    return markdownBlocks(entry.path, ownerId, markdown);
  }

  // Dossier d'une page → la page. Deux formes : « Titre <id> » (exports
  // anciens) et « Titre » seul (exports de 2026, mesuré sur deux archives
  // réelles). La seconde n'est retenue que si une seule page du dossier porte
  // ce titre : entre deux homonymes, on ne devine pas.
  const pageByFolder = new Map<string, string>();
  const ambiguousFolders = new Set<string>();
  for (const page of docPages) pageByFolder.set(stripExtension(page.path), pageIds.get(page.path)!);
  const byTitleFolder = new Map<string, string[]>();
  for (const page of docPages) {
    const folder = joinPath(page.dir, page.title);
    byTitleFolder.set(folder, [...(byTitleFolder.get(folder) ?? []), pageIds.get(page.path)!]);
  }
  for (const [folder, owners] of byTitleFolder) {
    if (pageByFolder.has(folder)) continue;
    if (owners.length === 1) pageByFolder.set(folder, owners[0]);
    else ambiguousFolders.add(folder);
  }
  // Repli sur targetByKey : il couvre aussi le dossier « Titre <id> » d'une entrée.
  const folderPage = (dir: string): string | null => {
    if (dir === "") return null;
    const known = pageByFolder.get(dir);
    if (known) return known;
    const target = targetByKey.get(dir);
    return target && target.kind === "page" ? target.id : null;
  };

  const parentOf = new Map<string, string | null>();
  for (const page of docPages) {
    parentOf.set(page.path, folderPage(page.dir));
    if (ambiguousFolders.has(page.dir)) {
      count(converted, "page rangée dans la page conteneur : son dossier porte le titre de deux pages");
    }
  }
  const pageRoots = docPages.filter((page) => parentOf.get(page.path) === null);
  const databaseRoots = archive.databases.filter((db) => db.dir === "");

  let rootId: string;
  let rootTitle: string;
  const pages: PlanPage[] = [];
  const rootIsPage = pageRoots.length === 1 && databaseRoots.length === 0;
  if (rootIsPage) {
    rootId = pageIds.get(pageRoots[0].path)!;
    rootTitle = titleOf(pageRoots[0], rootId);
  } else {
    rootId = makeId("pg");
    rootTitle = CONTAINER_TITLE;
    pages.push({
      id: rootId,
      parentId: null,
      dbId: null,
      type: "page",
      title: CONTAINER_TITLE,
      icon: null,
      cover: null,
      coverPosition: null,
      body: [],
      bodyText: "",
      dbConfig: null,
      propertyValues: null,
      valuesText: "",
      manualOrder: 0,
    });
    count(converted, "racines de l'export regroupées dans une page conteneur");
  }

  // Ordre des sous-pages : l'export HTML le porte dans le corps de la page
  // mère ; l'export Markdown ne le porte pas (tri alphabétique).
  const htmlOrder = new Map<string, number>();
  if (format === "html") {
    const childOrder = new Map<string, Map<string, number>>();
    for (const page of docPages) {
      const parentId = pageIds.get(page.path)!;
      const positions = new Map<string, number>();
      readHtml(page, parentId).subpageIds.forEach((notionId, index) => {
        const target = targetByNotionId.get(notionId.toLowerCase());
        if (target && target.kind === "page" && !positions.has(target.id)) positions.set(target.id, index);
      });
      if (positions.size > 0) childOrder.set(parentId, positions);
    }
    const siblings = new Map<string, NotionItem[]>();
    for (const page of docPages) {
      const parent = parentOf.get(page.path) ?? (rootIsPage ? "__root__" : rootId);
      siblings.set(parent, [...(siblings.get(parent) ?? []), page]);
    }
    for (const [parent, list] of siblings) {
      const positions = childOrder.get(parent);
      const sorted = [...list].sort((a, b) => {
        const posA = positions?.get(pageIds.get(a.path)!) ?? Number.MAX_SAFE_INTEGER;
        const posB = positions?.get(pageIds.get(b.path)!) ?? Number.MAX_SAFE_INTEGER;
        return posA - posB || a.path.localeCompare(b.path);
      });
      sorted.forEach((page, index) => htmlOrder.set(page.path, index));
    }
  }

  const order = new Map<string, number>();
  const sortedDocs = [...docPages].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
  );
  for (const page of sortedDocs) {
    const effectiveParent = parentOf.get(page.path) ?? (rootIsPage ? null : rootId);
    const key = effectiveParent ?? "__root__";
    let manualOrder: number;
    if (format === "html") {
      manualOrder = htmlOrder.get(page.path) ?? 0;
    } else {
      const next = (order.get(key) ?? -1) + 1;
      order.set(key, next);
      manualOrder = next;
    }
    const ownerId = pageIds.get(page.path)!;
    const title = titleOf(page, ownerId);
    const body = blocksOf(page, ownerId);
    pages.push({
      id: ownerId,
      parentId: effectiveParent,
      dbId: null,
      type: "page",
      title,
      ...decorationOf(page, ownerId),
      body,
      bodyText: flattenToText(body),
      dbConfig: null,
      propertyValues: null,
      valuesText: "",
      manualOrder,
    });
  }

  let databases = 0;
  let entries = 0;
  for (const db of archive.databases) {
    const baseId = databaseIds.get(db.path)!;
    const parentId = folderPage(db.dir) ?? rootId;
    const stub = archive.stubs.find((item) => stripExtension(item.path) === dbFolder(db));
    const body = stub ? blocksOf(stub, baseId) : [];
    const csv = contentByPath.get(db.path);
    const table = parseCsv(csv ? decode(csv) : "");
    const built = buildCsvDatabase(table, {
      makeId,
      resolveLink: (href) => {
        const notion = NOTION_URL_ID.exec(href);
        const target = notion ? targetByNotionId.get(notion[1].toLowerCase()) : undefined;
        if (!target) return null;
        return {
          href: target.kind === "database" ? `/db/${target.id}` : `/page/${target.id}`,
          title: target.title,
          pageId: target.id,
          kind: target.kind,
          dbId: target.dbId,
          dbTitle: target.dbTitle,
        };
      },
    });
    for (const note of built.notes) count(converted, note.reason, note.count);
    for (const note of built.ignored) count(ignored, note.reason, note.count);

    databases++;
    pages.push({
      id: baseId,
      parentId,
      dbId: null,
      type: "database",
      title: db.title,
      icon: null,
      cover: null,
      coverPosition: null,
      body,
      bodyText: flattenToText(body),
      dbConfig: built.config,
      propertyValues: null,
      valuesText: "",
      manualOrder: 0,
    });

    const entryDirs = new Set(entryDirsOf(db));
    const entryFiles = docEntries.filter((entry) => entryDirs.has(entry.dir));
    const byTitle = new Map<string, NotionItem[]>();
    for (const file of entryFiles) {
      // En HTML, le nom de fichier est tronqué à 50 caractères par Notion : le
      // titre lisible est dans le h1 de la page.
      const fileId = entryIds.get(file.path)!;
      const key = fold(titleOf(file, fileId));
      byTitle.set(key, [...(byTitle.get(key) ?? []), file]);
    }
    built.entries.forEach((line, index) => {
      const key = fold(line.title);
      const candidates = byTitle.get(key) ?? [];
      const file = candidates.shift();
      if (candidates.length === 0) byTitle.delete(key);
      const fileId = file ? entryIds.get(file.path)! : makeId("pg");
      const bodyBlocks = file ? blocksOf(file, fileId, line.extraMarkdown) : [];
      if (!file && line.extraMarkdown) {
        bodyBlocks.push(...markdownBlocks(db.path, fileId, line.extraMarkdown));
      }
      pages.push({
        id: fileId,
        parentId: null,
        dbId: baseId,
        type: "entry",
        title: line.title,
        ...(file ? decorationOf(file, fileId) : { icon: null, cover: null, coverPosition: null }),
        body: bodyBlocks,
        bodyText: flattenToText(bodyBlocks),
        dbConfig: null,
        propertyValues: line.values,
        valuesText: valuesToText(built.config.properties, line.values),
        manualOrder: index,
      });
      entries++;
    });
    const orphans = [...byTitle.values()].flat().length;
    if (orphans > 0) count(ignored, "corps d'entrée sans ligne correspondante", orphans);
  }

  const iconMediaList = [...iconMedia.values()];
  return {
    rootId,
    pages,
    media: [...mediaByPath.values(), ...iconMediaList.map((item) => item.media)],
    icons: iconMediaList.map((item) => item.icon),
    remotes,
    report: {
      rootId,
      rootTitle,
      counts: {
        pages: docPages.length,
        databases,
        entries,
        media: mediaByPath.size + iconMediaList.length,
      },
      ignored: notes(ignored),
      notes: notes(converted),
    },
  };
}
