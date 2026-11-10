// Écritures de l'accès agent (SPECS.md, « Accès agent », palier c) : le
// Markdown reçu devient des blocs par le profil « agent » de markdownToBlocks,
// avec liens et médias résolus contre la base. Les gestes eux-mêmes passent
// par les fonctions de l'éditeur (createPage, appendBlocks, updatePage,
// movePage…) dans les routes, qui journalisent chacun.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { media, pages } from "@/db/schema";
import { pathRows } from "./agent_read";
import { toList, type AgentValues, type RelationAnswers } from "./agent_values";
import { internalLinkId } from "./blocks";
import { markdownToBlocks, type MarkdownContext, type ResolvedLink } from "./notion-markdown";
import { looksLikeId, resolvePath, type PathRow } from "./page_path";
import { fold, type Property } from "./properties";
import { isStoredName } from "./upload_rules";

export const MARKDOWN_MAX = 1_000_000;
export const TITLE_MAX = 500;

export type Conversion = { blocks: unknown[]; ignored: string[]; converted: string[] };

const MEDIA_PATH = /\/api\/media\/([A-Za-z0-9_.-]+)/g;

// Le Markdown d'un champ JSON : une chaîne, bornée.
export function readMarkdown(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Markdown attendu (champ markdown)" };
  if (raw.length > MARKDOWN_MAX) return { error: `Markdown trop long (${MARKDOWN_MAX} caractères au plus)` };
  return { value: raw };
}

export function readTitle(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Titre attendu" };
  const title = raw.replace(/[\r\n]+/g, " ").trim();
  if (title.length > TITLE_MAX) return { error: `Titre trop long (${TITLE_MAX} caractères au plus)` };
  return { value: title };
}

// Les raisons répétées se comptent : « média distant laissé en lien (3) ».
function tally(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => (n > 1 ? `${reason} (${n})` : reason));
}

function linkTo(row: PathRow): ResolvedLink {
  const database = row.type === "database";
  return { href: `/${database ? "db" : "page"}/${row.id}`, pageId: row.id, kind: database ? "database" : "page" };
}

// Un lien vers un fichier .md du vault vise la page de même titre : le chemin
// entier d'abord, puis son seul nom. « installer_linux_mint.md » trouve
// « Installer Linux Mint ».
function mdSegments(href: string): string[] {
  let path = href.replace(/[?#].*$/, "").replace(/\.md$/i, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Un % isolé reste tel quel.
  }
  return path
    .split("/")
    .map((segment) => segment.replace(/_/g, " ").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

// Les raisons du convertisseur parlent de l'archive de l'import Notion ; pour
// un fichier du vault, elles disent ce qui reste dans la page.
const AGENT_WORDING: Record<string, string> = {
  "lien sans cible dans l'archive": "lien sans page connue, gardé en texte",
  "sous-page hors de l'archive": "lien sans page connue, gardé en texte",
  "image absente de l'archive": "image locale non téléversée, gardée en texte",
  "fichier absent de l'archive": "fichier local non téléversé, gardé en texte",
};

// Titres d'entrées cités par une relation : chaque titre est cherché parmi les
// entrées vivantes de la base visée, sans accents ni casse. Un titre absent ou
// porté par plusieurs entrées refuse la requête entière, et le dit.
export async function resolveRelationAnswers(
  properties: readonly Property[],
  raw: AgentValues,
): Promise<RelationAnswers> {
  const answers: RelationAnswers = new Map();
  const wanted = new Map(Object.entries(raw).map(([name, value]) => [fold(name), value]));
  for (const prop of properties) {
    if (prop.type !== "relation" || prop.twinOf) continue;
    const input = wanted.get(fold(prop.name));
    if (input === undefined) continue;
    const titles = toList(input);
    if (!titles || !titles.length) continue;

    const rows = await db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(and(eq(pages.dbId, prop.target ?? ""), eq(pages.type, "entry"), isNull(pages.trashedAt)));
    const ids: string[] = [];
    let error: string | null = null;
    for (const title of titles) {
      const matches = rows.filter((row) => fold(row.title || "") === fold(title));
      if (matches.length === 0) {
        error = `${prop.name} : aucune entrée « ${title} » dans la base visée`;
        break;
      }
      if (matches.length > 1) {
        const names = matches.map((row) => `${row.title || "Sans titre"} ${row.id}`).join(", ");
        error = `${prop.name} : « ${title} » désigne ${matches.length} entrées (${names})`;
        break;
      }
      if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
    }
    answers.set(prop.id, error ? { error } : { ids });
  }
  return answers;
}

export async function convertMarkdown(markdown: string, origin: string | null): Promise<Conversion> {
  const rows = await pathRows();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const strip = (href: string) => (origin && href.startsWith(`${origin}/`) ? href.slice(origin.length) : href);

  // Médias déjà téléversés que le Markdown cite (relus d'un np lire, ou posés
  // par np au palier e) : seuls ceux qui existent deviennent des blocs.
  const cited = [...new Set([...markdown.matchAll(MEDIA_PATH)].map((match) => match[1]).filter(isStoredName))];
  const known = new Set(
    cited.length
      ? (await db.select({ filename: media.filename }).from(media).where(inArray(media.filename, cited))).map((row) => row.filename)
      : [],
  );

  const ignored: string[] = [];
  const converted: string[] = [];
  const ctx: MarkdownContext = {
    profile: "agent",
    newBlockId: () => globalThis.crypto.randomUUID(),
    resolveMedia: (href) => {
      const name = /^\/api\/media\/([^/?#]+)$/.exec(strip(href.trim()))?.[1];
      return name && known.has(name) ? `/api/media/${name}` : null;
    },
    resolveLink: (href) => {
      const clean = strip(href.trim());
      const id = looksLikeId(clean) ? clean : internalLinkId(clean);
      if (id) {
        const row = byId.get(id);
        return row ? linkTo(row) : null;
      }
      if (!/\.md(?:[?#]|$)/i.test(clean) || /^[a-z]+:/i.test(clean)) return null;
      const segments = mdSegments(clean);
      for (const tried of [segments, segments.slice(-1)]) {
        const found = tried.length ? resolvePath(rows, tried) : { kind: "none" as const };
        if (found.kind === "found") return linkTo(byId.get(found.id)!);
      }
      return null;
    },
    onIgnored: (reason) => ignored.push(AGENT_WORDING[reason] ?? reason),
    onConverted: (reason) => converted.push(reason),
  };
  const { blocks } = markdownToBlocks(markdown, ctx);
  return { blocks, ignored: tally(ignored), converted: tally(converted) };
}
