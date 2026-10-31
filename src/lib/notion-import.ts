// Import d'un export Notion « Markdown & CSV » : de l'archive au plan d'écriture.
// Module pur (aucune base, aucun disque) : il rend des pages prêtes à insérer,
// leurs médias et un rapport. L'écriture vit dans lib/import_write.ts.
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
  pageId: string;
};

export type PlanPage = {
  id: string;
  parentId: string | null;
  dbId: string | null;
  type: "page" | "database" | "entry";
  title: string;
  body: Block[];
  bodyText: string;
  dbConfig: DbConfig | null;
  propertyValues: Values | null;
  valuesText: string;
  // Rang parmi les frères, converti en clé d'ordre à l'écriture (import_write).
  manualOrder: number;
};

export type ImportPlan = { rootId: string; pages: PlanPage[]; media: PlanMedia[]; report: ImportReport };

export type ImportOptions = { newId?: (prefix: string) => string; newBlockId?: () => string };

type Target = { id: string; kind: "page" | "database"; title: string };

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
  if (archive.htmlOnly) {
    throw new NotionImportError(
      "Cet export est en HTML. Dans Notion, choisissez « Exporter → Markdown & CSV », puis déposez le zip.",
    );
  }
  if (archive.pages.length === 0 && archive.databases.length === 0 && archive.stubs.length === 0) {
    throw new NotionImportError("Aucune page ni base dans l'archive : vérifiez l'export Notion.");
  }

  const contentByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const ignored = new Map<string, number>();
  const converted = new Map<string, number>();
  for (const warning of archive.warnings) count(ignored, warning);
  if (archive.others.length > 0) count(ignored, "fichier non pris en charge", archive.others.length);

  // Identifiants tirés avant toute lecture : les médias et les liens ont besoin
  // des adresses finales, et l'écriture ne doit rien décider.
  const pageIds = new Map(archive.pages.map((page) => [page.path, makeId("pg")]));
  const databaseIds = new Map(archive.databases.map((db) => [db.path, makeId("pg")]));
  const entryIds = new Map(archive.entries.map((entry) => [entry.path, makeId("pg")]));

  const targetByKey = new Map<string, Target>();
  const targetByNotionId = new Map<string, Target>();
  const remember = (key: string, target: Target, notionId: string) => {
    targetByKey.set(key, target);
    if (notionId) targetByNotionId.set(notionId, target);
  };
  for (const page of archive.pages) {
    remember(stripExtension(page.path), { id: pageIds.get(page.path)!, kind: "page", title: page.title }, page.notionId);
  }
  // Le CSV complet (_all) et le stub .md de la même base partagent le dossier
  // « Base <id> », qui est la clé commune des liens.
  const dbFolder = (db: NotionItem) => joinPath(db.dir, db.base.replace(/_all$/i, ""));
  for (const db of archive.databases) {
    remember(dbFolder(db), { id: databaseIds.get(db.path)!, kind: "database", title: db.title }, db.notionId);
  }
  for (const entry of archive.entries) {
    remember(stripExtension(entry.path), { id: entryIds.get(entry.path)!, kind: "page", title: entry.title }, entry.notionId);
  }

  const mediaByPath = new Map<string, PlanMedia>();
  function mediaUrl(ownerId: string, fromPath: string, href: string): string | null {
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

  function blocksOf(entry: NotionItem, ownerId: string, extra = ""): Block[] {
    const data = contentByPath.get(entry.path);
    if (!data) return [];
    const markdown = extra ? `${decode(data)}\n\n${extra}` : decode(data);
    return markdownToBlocks(markdown, {
      newBlockId,
      resolveLink: (href) => resolveLink(entry.path, href),
      resolveMedia: (href) => mediaUrl(ownerId, entry.path, href),
      onIgnored: (reason) => count(ignored, reason),
      onConverted: (reason) => count(converted, reason),
    }).blocks;
  }

  const parentOf = new Map<string, string | null>();
  for (const page of archive.pages) {
    const target = page.dir === "" ? null : targetByKey.get(page.dir);
    parentOf.set(page.path, target && target.kind === "page" ? target.id : null);
  }
  const pageRoots = archive.pages.filter((page) => parentOf.get(page.path) === null);
  const databaseRoots = archive.databases.filter((db) => db.dir === "");

  let rootId: string;
  let rootTitle: string;
  const pages: PlanPage[] = [];
  const rootIsPage = pageRoots.length === 1 && databaseRoots.length === 0;
  if (rootIsPage) {
    rootId = pageIds.get(pageRoots[0].path)!;
    rootTitle = pageRoots[0].title;
  } else {
    rootId = makeId("pg");
    rootTitle = CONTAINER_TITLE;
    pages.push({
      id: rootId,
      parentId: null,
      dbId: null,
      type: "page",
      title: CONTAINER_TITLE,
      body: [],
      bodyText: "",
      dbConfig: null,
      propertyValues: null,
      valuesText: "",
      manualOrder: 0,
    });
    count(converted, "racines de l'export regroupées dans une page conteneur");
  }

  const order = new Map<string, number>();
  for (const page of [...archive.pages].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
  )) {
    const effectiveParent = parentOf.get(page.path) ?? (rootIsPage ? null : rootId);
    const key = effectiveParent ?? "__root__";
    const next = (order.get(key) ?? -1) + 1;
    order.set(key, next);
    const body = blocksOf(page, pageIds.get(page.path)!);
    pages.push({
      id: pageIds.get(page.path)!,
      parentId: effectiveParent,
      dbId: null,
      type: "page",
      title: page.title,
      body,
      bodyText: flattenToText(body),
      dbConfig: null,
      propertyValues: null,
      valuesText: "",
      manualOrder: next,
    });
  }

  let databases = 0;
  let entries = 0;
  for (const db of archive.databases) {
    const baseId = databaseIds.get(db.path)!;
    const parentTarget = db.dir === "" ? null : targetByKey.get(db.dir);
    const parentId = parentTarget && parentTarget.kind === "page" ? parentTarget.id : rootId;
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
        return { href: target.kind === "database" ? `/db/${target.id}` : `/page/${target.id}`, title: target.title };
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
      body,
      bodyText: flattenToText(body),
      dbConfig: built.config,
      propertyValues: null,
      valuesText: "",
      manualOrder: 0,
    });

    // Le dossier des entrées porte l'identifiant de la base, ou son seul titre
    // quand la base est une page du même nom (voir indexArchive).
    const entryDirs = new Set([dbFolder(db)]);
    if (db.title) entryDirs.add(joinPath(db.dir, db.title));
    const entryFiles = archive.entries.filter((entry) => entryDirs.has(entry.dir));
    const byTitle = new Map<string, NotionItem[]>();
    for (const file of entryFiles) {
      const key = fold(file.title);
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
        bodyBlocks.push(
          ...markdownToBlocks(line.extraMarkdown, {
            newBlockId,
            resolveLink: (href) => resolveLink(db.path, href),
            resolveMedia: () => null,
            onIgnored: (reason) => count(ignored, reason),
            onConverted: (reason) => count(converted, reason),
          }).blocks,
        );
      }
      pages.push({
        id: fileId,
        parentId: null,
        dbId: baseId,
        type: "entry",
        title: line.title,
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

  return {
    rootId,
    pages,
    media: [...mediaByPath.values()],
    report: {
      rootId,
      rootTitle,
      counts: { pages: archive.pages.length, databases, entries, media: mediaByPath.size },
      ignored: notes(ignored),
      notes: notes(converted),
    },
  };
}
