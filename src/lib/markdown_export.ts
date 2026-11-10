// Corps BlockNote → Markdown, pour l'accès agent (SPECS.md, « Accès agent »,
// « Blocs → Markdown »). Module pur, jumeau de renderHtml (lib/blocks.ts) :
// ce qu'il ne sait pas lire en base (titre d'une sous-page, d'une base liée)
// lui est donné par une fonction. Le Markdown produit se relit par
// markdownToBlocks : seuls les caractères que parseInline sait déséchapper le
// sont ici, sans quoi une barre oblique resterait dans le texte relu.
import { mentionProps } from "./mention.ts";
import {
  isSimpleType,
  normalizeValue,
  optionById,
  valueText,
  type EntryRow,
  type Property,
} from "./properties.ts";
import { domainOf } from "./unfurl.ts";

type Json = unknown;

// Cible d'un bloc-lien (sous-page, lien vers une page, vue liée) : son titre,
// ou null si elle n'est plus lisible (corbeille, purge) et que le bloc se tait.
export type LinkTarget = { title: string };

export type ExportOptions = {
  // Origine publique du site : les médias (/api/media/…) et les liens internes
  // deviennent des adresses absolues. Absente : les chemins restent relatifs.
  origin?: string;
  target?: (pageId: string) => LinkTarget | null;
};

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function propsOf(block: Record<string, Json>): Record<string, Json> {
  return isObject(block.props) ? block.props : {};
}

function childrenOf(block: Record<string, Json>): Json[] {
  return Array.isArray(block.children) ? block.children : [];
}

function str(value: Json): string {
  return typeof value === "string" ? value : "";
}

// --- Contenu en ligne -----------------------------------------------------------

// Échappement minimal : `*`, `` ` ``, `[`, `]`, `\` partout, `~~` en paire,
// `_` seulement là où parseInline l'ouvrirait (entre deux non-lettres), `#`
// en tête de bloc (sinon un paragraphe relu deviendrait un titre).
export function escapeMarkdown(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ("\\*`[]".includes(char)) out += `\\${char}`;
    else if (char === "~" && (text[i + 1] === "~" || text[i - 1] === "~")) out += "\\~";
    else if (char === "_" && !/[A-Za-z0-9]/.test(text[i - 1] ?? "") && !/[A-Za-z0-9]/.test(text[i + 1] ?? "")) out += "\\_";
    else out += char;
  }
  return out;
}

function absolute(href: string, options: ExportOptions): string {
  const clean = href.trim().replace(/ /g, "%20");
  return options.origin && /^\/(?![/\\])/.test(clean) ? `${options.origin}${clean}` : clean;
}

type Run = { text: string; styles: Record<string, Json> };

// Les marques Markdown n'admettent pas d'espace à l'intérieur de leurs bords :
// « ** gras** » ne se lit pas comme du gras. L'espace sort de la marque.
function styledRun(run: Run): string {
  const { styles } = run;
  const lead = /^\s*/.exec(run.text)?.[0] ?? "";
  const trail = /\s*$/.exec(run.text.slice(lead.length))?.[0] ?? "";
  const core = run.text.slice(lead.length, run.text.length - trail.length);
  if (core === "") return run.text;
  let md: string;
  // Le code est littéral : un accent grave dedans ne se relirait pas.
  if (styles.code === true && !core.includes("`")) md = `\`${core}\``;
  else {
    md = escapeMarkdown(core);
    if (styles.strike === true) md = `~~${md}~~`;
    if (styles.bold === true && styles.italic === true) md = `***${md}***`;
    else if (styles.bold === true) md = `**${md}**`;
    else if (styles.italic === true) md = `*${md}*`;
  }
  return lead + md + trail;
}

const MARKS = ["bold", "italic", "strike", "code"] as const;

function sameMarks(a: Record<string, Json>, b: Record<string, Json>): boolean {
  return MARKS.every((mark) => (a[mark] === true) === (b[mark] === true));
}

// Deux textes voisins de même style fusionnent : « **a****b** » se relirait mal.
function runsMarkdown(runs: Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && sameMarks(last.styles, run.styles)) last.text += run.text;
    else merged.push({ text: run.text, styles: run.styles });
  }
  return merged.map(styledRun).join("");
}

function textRuns(content: Json): Run[] {
  if (!Array.isArray(content)) return typeof content === "string" ? [{ text: content, styles: {} }] : [];
  return content.flatMap((item): Run[] => {
    if (typeof item === "string") return [{ text: item, styles: {} }];
    if (isObject(item) && item.type === "text" && typeof item.text === "string") {
      return [{ text: item.text, styles: isObject(item.styles) ? item.styles : {} }];
    }
    return [];
  });
}

export function inlineMarkdown(content: Json, options: ExportOptions = {}): string {
  if (typeof content === "string") return escapeMarkdown(content);
  if (!Array.isArray(content)) return "";
  let out = "";
  let pending: Run[] = [];
  const flush = () => {
    out += runsMarkdown(pending);
    pending = [];
  };
  for (const item of content) {
    if (!isObject(item)) {
      if (typeof item === "string") pending.push({ text: item, styles: {} });
      continue;
    }
    if (item.type === "text") {
      pending.push(...textRuns([item]));
      continue;
    }
    flush();
    if (item.type === "link") {
      const label = runsMarkdown(textRuns(item.content));
      const href = str(item.href).trim();
      out += href ? `[${label || escapeMarkdown(href)}](${absolute(href, options)})` : label;
    } else if (item.type === "mention") {
      const mention = mentionProps(item.props);
      if (mention) out += `[${escapeMarkdown(mention.title || domainOf(mention.url) || mention.url)}](${absolute(mention.url, options)})`;
    }
  }
  flush();
  return out;
}

// --- Blocs ---------------------------------------------------------------------

// Un morceau de document : ses lignes, et la nature de sa liste s'il en est un
// élément. Deux éléments voisins de même nature ne sont pas séparés par une
// ligne vide ; une puce suivie d'un numéro l'est, sans quoi les deux listes
// n'en feraient qu'une à la relecture.
type Chunk = { lines: string[]; list: string | null };

function paragraphLines(text: string): string[] {
  return text.split("\n");
}

function indent(lines: string[], width: number): string[] {
  const pad = " ".repeat(width);
  return lines.map((line) => (line === "" ? "" : pad + line));
}

function joinChunks(chunks: Chunk[]): string[] {
  const lines: string[] = [];
  chunks.forEach((chunk, index) => {
    if (index > 0 && !(chunk.list && chunk.list === chunks[index - 1].list)) lines.push("");
    lines.push(...chunk.lines);
  });
  return lines;
}

function cellMarkdown(cell: Json, options: ExportOptions): string {
  const content = isObject(cell) && cell.type === "tableCell" ? cell.content : cell;
  return inlineMarkdown(content, options).replace(/\|/g, "\\|").replace(/\n/g, "<br>").trim();
}

export function tableMarkdown(rows: string[][]): string[] {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] || " ").join(" | ")} |`;
  const [head, ...rest] = rows.length ? rows : [[]];
  return [line(head), `|${" --- |".repeat(width)}`, ...rest.map(line)];
}

function tableLines(content: Record<string, Json>, options: ExportOptions): string[] {
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const cells = rows.map((row) => (isObject(row) && Array.isArray(row.cells) ? row.cells.map((cell) => cellMarkdown(cell, options)) : []));
  return cells.length ? tableMarkdown(cells) : [];
}

function linkLine(label: string, href: string, options: ExportOptions): string {
  return `[${escapeMarkdown(label)}](${absolute(href, options)})`;
}

// Élément de liste : marque, texte, puis ses enfants décalés de la largeur de
// la marque (trois espaces sous « 1. », deux sous « - »).
function listChunk(block: Record<string, Json>, kind: string, marker: string, options: ExportOptions): Chunk {
  const text = inlineMarkdown(block.content, options).replace(/\n/g, " ");
  const children = joinChunks(blocksChunks(childrenOf(block), options));
  const width = /^\d+\. /.test(marker) ? marker.length : 2;
  return { lines: [`${marker}${text}`.trimEnd(), ...indent(children, width)], list: kind };
}

function blockChunks(block: Json, number: number, options: ExportOptions): Chunk[] {
  if (!isObject(block)) return [];
  const props = propsOf(block);
  const children = childrenOf(block);
  // Enfants d'un bloc qui n'est pas une liste : aplatis à sa suite, comme
  // l'export Notion.
  const after = () => blocksChunks(children, options);
  const own = (lines: string[]): Chunk[] => (lines.length ? [{ lines, list: null }, ...after()] : after());
  switch (block.type) {
    case "paragraph": {
      const text = inlineMarkdown(block.content, options);
      return own(text.trim() ? paragraphLines(text.replace(/^#/, "\\#")).map((line, i, all) => (i < all.length - 1 ? `${line}  ` : line)) : []);
    }
    case "heading": {
      const level = typeof props.level === "number" ? Math.min(Math.max(Math.floor(props.level), 1), 3) : 1;
      const text = inlineMarkdown(block.content, options).replace(/\n/g, " ");
      return own(text.trim() ? [`${"#".repeat(level)} ${text}`] : []);
    }
    case "quote": {
      const text = inlineMarkdown(block.content, options);
      return own(text.trim() ? paragraphLines(text).map((line) => `> ${line}`.trimEnd()) : []);
    }
    case "bulletListItem":
    case "toggleListItem":
      return [listChunk(block, "bullet", "- ", options)];
    case "checkListItem":
      return [listChunk(block, "check", props.checked === true ? "- [x] " : "- [ ] ", options)];
    case "numberedListItem":
      return [listChunk(block, "numbered", `${number}. `, options)];
    case "codeBlock": {
      const code = textRuns(block.content).map((run) => run.text).join("");
      const language = str(props.language);
      const fence = code.includes("```") ? "````" : "```";
      return own([`${fence}${language && language !== "plain" && language !== "text" ? language : ""}`, ...code.split("\n"), fence]);
    }
    case "divider":
      return own(["---"]);
    case "table": {
      const { content } = block;
      return own(isObject(content) && content.type === "tableContent" ? tableLines(content, options) : []);
    }
    case "image": {
      const url = str(props.url).trim();
      if (!url) return after();
      const alt = str(props.caption) || str(props.name);
      return own([`![${escapeMarkdown(alt)}](${absolute(url, options)})`]);
    }
    case "file": {
      const url = str(props.url).trim();
      if (!url) return after();
      const caption = str(props.caption).trim();
      return own([linkLine(str(props.name) || "Fichier", url, options), ...(caption ? ["", escapeMarkdown(caption)] : [])]);
    }
    case "bookmark": {
      const url = str(props.url).trim();
      return own(url ? [linkLine(str(props.title) || url, url, options)] : []);
    }
    case "youtube": {
      const url = str(props.url).trim();
      return own(url ? [linkLine("Vidéo YouTube", url, options)] : []);
    }
    case "subpage":
    case "linked": {
      const id = str(block.type === "subpage" ? props.pageId : props.databaseId);
      const target = id && options.target ? options.target(id) : null;
      return own(target ? [linkLine(target.title || "Sans titre", id, options)] : []);
    }
    // Mise en page et encadré de fusion : leur contenu, dans l'ordre.
    case "columnList":
    case "column":
    case "conflict":
      return after();
    default: {
      const { content } = block;
      if (isObject(content) && content.type === "tableContent") return own(tableLines(content, options));
      const text = inlineMarkdown(content, options);
      return own(text.trim() ? paragraphLines(text) : []);
    }
  }
}

// Numérotation : une suite d'éléments numérotés compte depuis le `start` du
// premier (ou d'un élément qui en porte un), sinon depuis 1.
function blocksChunks(blocks: Json[], options: ExportOptions): Chunk[] {
  const chunks: Chunk[] = [];
  let number = 0;
  for (const block of blocks) {
    const numbered = isObject(block) && block.type === "numberedListItem";
    if (numbered) {
      const start = propsOf(block).start;
      number = typeof start === "number" && start >= 1 ? Math.floor(start) : number + 1;
    } else {
      number = 0;
    }
    chunks.push(...blockChunks(block, number, options));
  }
  return chunks;
}

export function blocksToMarkdown(body: Json, options: ExportOptions = {}): string {
  if (!Array.isArray(body)) return "";
  const lines = joinChunks(blocksChunks(body, options));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

// --- Bases et entrées ----------------------------------------------------------

// Texte d'une cellule du tableau d'une base : la forme de recherche, sauf la
// case cochée, plus lisible en « oui ».
function cellText(prop: Property, value: unknown): string {
  if (prop.type === "checkbox") return value === true ? "oui" : "";
  return valueText(prop, value);
}

// Une base se lit en tableau : titre (lien vers l'id de l'entrée), puis ses
// propriétés simples dans l'ordre du schéma.
export function databaseToMarkdown(properties: readonly Property[], entries: readonly EntryRow[]): string {
  const columns = properties.filter((prop) => isSimpleType(prop.type));
  const escapeCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  const rows = [
    ["Titre", ...columns.map((prop) => escapeCell(prop.name))],
    ...entries.map((entry) => [
      linkLine(entry.title || "Sans titre", entry.id, {}).replace(/\|/g, "\\|"),
      ...columns.map((prop) => escapeCell(cellText(prop, entry.values[prop.id]))),
    ]),
  ];
  const lines = tableMarkdown(rows);
  if (!entries.length) lines.push("", "Aucune entrée.");
  return `${lines.join("\n")}\n`;
}

// --- Front matter d'une entrée ---------------------------------------------------

type FrontValue = string | number | boolean | string[];

// Valeurs d'une entrée par nom de propriété, dans l'ordre du schéma : la forme
// que `np entree` relira (palier d). Cumul, Créé le et Modifié le, calculés,
// n'y figurent pas ; une valeur vide non plus.
export function entryValues(properties: readonly Property[], entry: EntryRow): [string, FrontValue][] {
  const pairs: [string, FrontValue][] = [];
  for (const prop of properties) {
    if (prop.type === "relation") {
      const titles = (entry.links?.[prop.id] ?? []).filter((link) => !link.trashed).map((link) => link.title || "Sans titre");
      if (titles.length) pairs.push([prop.name, titles]);
      continue;
    }
    if (!isSimpleType(prop.type)) continue;
    const value = normalizeValue(prop, entry.values[prop.id]);
    if (value === undefined || value === "") continue;
    if (prop.type === "checkbox") pairs.push([prop.name, value === true]);
    else if (prop.type === "number" && typeof value === "number") pairs.push([prop.name, value]);
    else if (prop.type === "multiselect" && Array.isArray(value)) {
      const names = value.map((id) => optionById(prop, id)?.name ?? "").filter(Boolean);
      if (names.length) pairs.push([prop.name, names]);
    } else {
      const text = valueText(prop, value);
      if (text) pairs.push([prop.name, text]);
    }
  }
  return pairs;
}

const RESERVED = /^(true|false|yes|no|on|off|null|oui|non|~)$/i;

// Chaîne YAML : nue quand rien ne peut la faire lire autrement, sinon entre
// guillemets doubles (une chaîne JSON est une chaîne YAML valide).
export function yamlString(text: string): string {
  const plain =
    text !== "" &&
    text === text.trim() &&
    !RESERVED.test(text) &&
    !/^[-+]?(\d|\.\d)/.test(text) &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
    !/:(\s|$)|\s#|[\n\r\t]/.test(text);
  return plain ? text : JSON.stringify(text);
}

export function frontMatter(pairs: readonly [string, FrontValue][]): string {
  if (!pairs.length) return "";
  const lines = pairs.flatMap(([name, value]): string[] => {
    const key = yamlString(name);
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${yamlString(item)}`)];
    if (typeof value === "boolean") return [`${key}: ${value ? "oui" : "non"}`];
    if (typeof value === "number") return [`${key}: ${String(value)}`];
    return [`${key}: ${yamlString(value)}`];
  });
  return `---\n${lines.join("\n")}\n---\n`;
}
