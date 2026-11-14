// Mentions de sites (étape 22) : reconnaissance d'une adresse nue. Module pur,
// partagé par l'éditeur, l'agent et la conversion.
//
// Un lien est nu quand son texte est l'adresse elle-même, et non un titre. Le
// texte peut omettre le schéma (« exemple.org/page » lié vers
// « https://exemple.org/page ») ; le schéma et l'hôte sont comparés sans la
// casse de l'hôte, le chemin, la requête et l'ancre à l'identique.

import { mentionNode } from "./mention";

export type UrlSpan = { from: number; to: number; url: string };

function httpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Adresse d'un texte affiché : le schéma manquant vaut http, comme l'autolink.
function shownUrl(text: string): URL | null {
  const shown = text.trim();
  if (!shown || /\s/.test(shown)) return null;
  return httpUrl(/^https?:\/\//i.test(shown) ? shown : `http://${shown}`);
}

export function isBareLink(text: string, href: string): boolean {
  const target = httpUrl(href);
  const shown = shownUrl(text);
  if (!target || !shown) return false;
  return (
    target.host === shown.host &&
    target.pathname === shown.pathname &&
    target.search === shown.search &&
    target.hash === shown.hash
  );
}

// Adresses repérées dans un texte libre. Les parenthèses et crochets fermants
// ne sont retirés que s'ils ne sont pas appariés : une adresse Wikipédia garde
// les siens. La ponctuation finale part.
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const CLOSERS = /[.,;:!?…»”’]/u;

function trimEnd(raw: string): string {
  let url = raw;
  while (url && CLOSERS.test(url[url.length - 1])) url = url.slice(0, -1);
  for (const [open, close] of [["(", ")"], ["[", "]"]] as const) {
    while (url.endsWith(close)) {
      const opens = url.split(open).length - 1;
      const closes = url.split(close).length - 1;
      if (closes <= opens) break;
      url = url.slice(0, -1);
    }
  }
  return url;
}

export function bareUrlsInText(text: string): UrlSpan[] {
  const spans: UrlSpan[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const raw = trimEnd(match[0]);
    if (!raw) continue;
    const from = match.index ?? 0;
    spans.push({ from, to: from + raw.length, url: /^https?:\/\//i.test(raw) ? raw : `http://${raw}` });
  }
  return spans;
}

// Adresse seule dans un texte collé (espaces autour admis) : c'est elle que le
// collage transforme en mention, hors le cas YouTube traité par l'éditeur.
export function singleUrl(text: string): string | null {
  const trimmed = text.trim();
  const found = bareUrlsInText(trimmed);
  if (found.length !== 1) return null;
  const [only] = found;
  return only.from === 0 && only.to === trimmed.length ? only.url : null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Un élément en ligne « lien » dont le texte est l'adresse elle-même. Le
// contenu doit être du texte simple, sans code en ligne.
function bareHref(item: Json): string | null {
  if (item.type !== "link" || typeof item.href !== "string" || !Array.isArray(item.content)) return null;
  let text = "";
  for (const child of item.content) {
    if (!isObject(child) || child.type !== "text" || typeof child.text !== "string") return null;
    if (isObject(child.styles) && child.styles.code === true) return null;
    text += child.text;
  }
  return text && isBareLink(text, item.href) ? item.href : null;
}

type InlineVisit = (items: unknown[]) => { items: unknown[]; changed: boolean };

// Parcourt un corps BlockNote : contenus en ligne (paragraphes, cellules de
// tableau) et enfants, à toute profondeur. Le contenu d'un bloc de code est
// laissé tel quel.
function walkBlock(block: Json, visit: InlineVisit): { block: Json; changed: boolean } {
  let changed = false;
  const out: Json = { ...block };

  if (Array.isArray(block.children)) {
    const children = block.children.map((child) => {
      if (!isObject(child)) return child;
      const next = walkBlock(child, visit);
      if (next.changed) changed = true;
      return next.block;
    });
    if (changed) out.children = children;
  }

  const content = block.content;
  if (block.type !== "codeBlock") {
    if (Array.isArray(content)) {
      const next = visit(content);
      if (next.changed) {
        out.content = next.items;
        changed = true;
      }
    } else if (isObject(content) && content.type === "tableContent" && Array.isArray(content.rows)) {
      let tableChanged = false;
      const rows = content.rows.map((row) => {
        if (!isObject(row) || !Array.isArray(row.cells)) return row;
        let rowChanged = false;
        const cells = row.cells.map((cell) => {
          const next = visit(Array.isArray(cell) ? cell : []);
          if (next.changed) rowChanged = true;
          return next.items;
        });
        if (!rowChanged) return row;
        tableChanged = true;
        return { ...row, cells };
      });
      if (tableChanged) {
        out.content = { ...content, rows };
        changed = true;
      }
    }
  }

  return { block: out, changed };
}

// Adresses nues d'un corps, chacune une fois : paragraphes, listes, tableaux,
// à toute profondeur. Ni un lien titré, ni un bloc de code, ni du code en
// ligne n'en donnent.
export function bareLinkUrls(blocks: unknown): string[] {
  const urls = new Set<string>();
  const visit: InlineVisit = (items) => {
    for (const item of items) {
      if (isObject(item)) {
        const href = bareHref(item);
        if (href) urls.add(href);
      }
    }
    return { items, changed: false };
  };
  if (Array.isArray(blocks)) for (const block of blocks) if (isObject(block)) walkBlock(block, visit);
  return [...urls];
}

// Chaque lien nu devient une mention titrée (titre vide sans entrée : le
// domaine s'affiche). Le reste du corps est rendu intact.
export function mentionizeBlocks(blocks: unknown, titles: ReadonlyMap<string, string>): unknown[] {
  if (!Array.isArray(blocks)) return [];
  const visit: InlineVisit = (items) => {
    let changed = false;
    const out = items.map((item) => {
      if (!isObject(item)) return item;
      const href = bareHref(item);
      if (!href) return item;
      changed = true;
      return mentionNode(href, titles.get(href) ?? "");
    });
    return { items: changed ? out : items, changed };
  };
  return blocks.map((block) => (isObject(block) ? walkBlock(block, visit).block : block));
}
