// Lectures de l'accès agent (SPECS.md, « Accès agent », palier b) : pages en
// Markdown, enfants d'une page, chemin de titres, recherche, Vide-cerveau. Ce
// module lit la base et confie la conversion aux modules purs
// (markdown_export.ts, page_path.ts). Aucune lecture n'entre au journal, qui
// ne garde que les écritures.
import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { attachLinks, configOf, listEntries } from "./databases";
import { getInbox } from "./inbox";
import {
  blocksToMarkdown,
  databaseToMarkdown,
  entryValues,
  escapeMarkdown,
  frontMatter,
  type ExportOptions,
} from "./markdown_export";
import { joinPath, resolvePath, splitPath, titlesOf, type PathResult, type PathRow } from "./page_path";
import { getPage } from "./pages";
import { asValues } from "./properties";
import { HIT_END, HIT_START } from "./search";
import { searchPages } from "./search_query";

// Pages hors corbeille, entrées comprises : le parent d'une entrée est sa base.
export async function pathRows(): Promise<PathRow[]> {
  const rows = await db
    .select({ id: pages.id, parentId: pages.parentId, dbId: pages.dbId, type: pages.type, title: pages.title })
    .from(pages)
    .where(isNull(pages.trashedAt))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    parentId: row.type === "entry" ? row.dbId : row.parentId,
    type: row.type,
    title: row.title,
  }));
}

function indexRows(rows: readonly PathRow[]): Map<string, PathRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

export async function resolveAgentPath(raw: string): Promise<PathResult> {
  return resolvePath(await pathRows(), splitPath(raw));
}

export type AgentChild = { id: string; type: PathRow["type"]; title: string; path: string; children: number };

// Enfants d'une page (d'une base : ses entrées), ou racines de l'arbre.
export async function listChildren(parentId: string | null): Promise<AgentChild[] | null> {
  const rows = await pathRows();
  const byId = indexRows(rows);
  if (parentId && !byId.has(parentId)) return null;
  const counts = new Map<string, number>();
  for (const row of rows) if (row.parentId) counts.set(row.parentId, (counts.get(row.parentId) ?? 0) + 1);
  return rows
    .filter((row) => (parentId ? row.parentId === parentId : !row.parentId || !byId.has(row.parentId)))
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      path: joinPath(titlesOf(byId, row.id)),
      children: counts.get(row.id) ?? 0,
    }));
}

export type AgentPage = {
  id: string;
  type: PathRow["type"];
  title: string;
  icon: string | null;
  path: string;
  trashed: boolean;
  markdown: string;
};

function document(title: string, head: string, body: string): string {
  const heading = `# ${title.trim() || "Sans titre"}\n`;
  return [head, heading, body].filter(Boolean).join("\n");
}

// Une page en Markdown : front matter des valeurs pour une entrée, titre, puis
// corps ; une base en tableau de ses entrées ; un dossier en liste de liens.
export async function readPageMarkdown(id: string, origin: string | null): Promise<AgentPage | null> {
  const page = await getPage(id);
  if (!page) return null;
  const rows = await pathRows();
  const byId = indexRows(rows);
  const parent = page.type === "entry" ? page.dbId : page.parentId;
  const titles = byId.has(id) ? titlesOf(byId, id) : [...(parent ? titlesOf(byId, parent) : []), page.title];
  const options: ExportOptions = {
    origin: origin ?? undefined,
    target: (pageId) => {
      const row = byId.get(pageId);
      return row ? { title: row.title } : null;
    },
  };

  let head = "";
  let body: string;
  if (page.type === "database") {
    body = databaseToMarkdown(configOf(page).properties, await listEntries(page.id));
  } else if (page.type === "folder") {
    const children = rows.filter((row) => row.parentId === page.id);
    body = children.length
      ? `${children.map((row) => `- [${escapeMarkdown(row.title || "Sans titre")}](${row.id})`).join("\n")}\n`
      : "Dossier vide.\n";
  } else {
    if (page.type === "entry" && page.dbId) {
      const base = await getPage(page.dbId);
      if (base) {
        const properties = configOf(base).properties;
        const [entry] = await attachLinks(properties, [
          {
            id: page.id,
            title: page.title,
            icon: page.icon,
            values: asValues(page.propertyValues),
            manualOrder: page.manualOrder,
            createdAt: page.createdAt.toISOString(),
            updatedAt: page.updatedAt.toISOString(),
          },
        ]);
        head = frontMatter(entryValues(properties, entry));
      }
    }
    body = blocksToMarkdown(page.body, options);
  }

  return {
    id: page.id,
    type: page.type,
    title: page.title,
    icon: page.icon,
    path: joinPath(titles),
    trashed: page.trashedAt !== null,
    markdown: document(page.title, head, body),
  };
}

export type AgentHit = { id: string; type: PathRow["type"]; title: string; path: string; excerpt: string };

// Recherche de l'éditeur, chemin en plus ; les mots trouvés sont en gras dans
// l'extrait.
export async function searchForAgent(query: string): Promise<AgentHit[]> {
  const hits = await searchPages(query);
  if (!hits.length) return [];
  const byId = indexRows(await pathRows());
  return hits.map((hit) => ({
    id: hit.id,
    type: hit.type,
    title: hit.title,
    path: joinPath(byId.has(hit.id) ? titlesOf(byId, hit.id) : [hit.title]),
    excerpt: hit.excerpt.split(HIT_START).join("**").split(HIT_END).join("**").replace(/\s+/g, " ").trim(),
  }));
}

// Le Vide-cerveau en Markdown, sans rien y toucher : le rapatrier ne vide pas
// la page (choix d'Antonin du 2026-11-10).
export async function readInbox(origin: string | null): Promise<{ id: string | null; count: number; markdown: string }> {
  const inbox = await getInbox();
  if (!inbox || inbox.type !== "page") return { id: inbox?.id ?? null, count: 0, markdown: "" };
  const body = Array.isArray(inbox.body) ? inbox.body : [];
  return { id: inbox.id, count: body.length, markdown: blocksToMarkdown(body, { origin: origin ?? undefined }) };
}
