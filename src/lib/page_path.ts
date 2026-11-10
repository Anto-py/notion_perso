// Chemin de titres → page, pour l'accès agent (SPECS.md, « Accès agent »,
// « Chemin de titres »). Module pur : il reçoit la liste plate des pages hors
// corbeille, entrées comprises (leur parent est leur base).
//
// « Projets/Linux » se lit d'abord depuis les racines de l'arbre. Si rien ne
// répond, le chemin vaut pour la fin d'un chemin complet : « To Do » trouve
// « Ressources/Bases de données/To Do ». Titres comparés sans accents ni casse,
// espaces resserrées. Un « / » dans un titre s'écrit « \/ ».
import type { PageKind } from "./bases";
import { fold } from "./property_schema.ts";

export type PathRow = { id: string; parentId: string | null; type: PageKind; title: string };

export type PathCandidate = { id: string; type: PageKind; path: string };

export type PathResult =
  | { kind: "found"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: PathCandidate[] };

export const CANDIDATES_MAX = 20;
const UNTITLED = "Sans titre";

export function splitPath(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && raw[i + 1] === "/") {
      current += "/";
      i++;
    } else if (raw[i] === "/") {
      segments.push(current);
      current = "";
    } else {
      current += raw[i];
    }
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

export function joinPath(titles: readonly string[]): string {
  return titles.map((title) => (title.trim() || UNTITLED).replace(/\//g, "\\/")).join("/");
}

function key(title: string): string {
  return fold(title.trim() || UNTITLED).replace(/\s+/g, " ");
}

// Identifiant de ligne (lib/ids.ts, newId) : préfixe puis 16 caractères base64url.
export function looksLikeId(text: string): boolean {
  return /^[a-z]{2}_[A-Za-z0-9_-]{16}$/.test(text.trim());
}

// Titres de la racine jusqu'à la page comprise. Un parent absent de la liste
// (en corbeille) fait de la page une racine, comme dans la sidebar.
export function titlesOf(byId: ReadonlyMap<string, PathRow>, id: string): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  let row = byId.get(id);
  while (row && !seen.has(row.id)) {
    seen.add(row.id);
    titles.unshift(row.title);
    row = row.parentId ? byId.get(row.parentId) : undefined;
  }
  return titles;
}

function candidates(byId: ReadonlyMap<string, PathRow>, ids: readonly string[]): PathCandidate[] {
  return ids
    .map((id) => ({ id, type: byId.get(id)!.type, path: joinPath(titlesOf(byId, id)) }))
    .sort((a, b) => a.path.localeCompare(b.path, "fr"))
    .slice(0, CANDIDATES_MAX);
}

function settle(byId: ReadonlyMap<string, PathRow>, ids: readonly string[]): PathResult {
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "found", id: ids[0] };
  return { kind: "ambiguous", candidates: candidates(byId, ids) };
}

export function resolvePath(rows: readonly PathRow[], segments: readonly string[]): PathResult {
  if (!segments.length) return { kind: "none" };
  const byId = new Map(rows.map((row) => [row.id, row]));
  const wanted = segments.map(key);

  // Depuis les racines, niveau par niveau : le premier segment désigne une
  // racine, chacun des suivants un enfant du niveau précédent.
  const isRoot = (row: PathRow) => !row.parentId || !byId.has(row.parentId);
  let level: string[] = [];
  for (const [depth, segment] of wanted.entries()) {
    const parents = new Set(level);
    level = rows
      .filter((row) => key(row.title) === segment && (depth === 0 ? isRoot(row) : parents.has(row.parentId ?? "")))
      .map((row) => row.id);
    if (!level.length) break;
  }
  if (level.length) return settle(byId, level);

  // Sinon, n'importe quelle page dont le chemin finit par ces titres.
  const tail = rows
    .filter((row) => {
      const titles = titlesOf(byId, row.id).map(key);
      return titles.length >= wanted.length && wanted.every((segment, i) => titles[titles.length - wanted.length + i] === segment);
    })
    .map((row) => row.id);
  return settle(byId, tail);
}
