// Markdown d'export Notion → blocs BlockNote du schéma de l'éditeur. Module
// pur : liens et médias sont résolus par un contexte injecté, les identifiants
// de bloc aussi, si bien qu'il se teste sans DOM ni archive.
//
// Ce que l'export porte et que le schéma ne connaît pas est converti et
// signalé : tableau pipe → liste à puces, <aside> → citation, colonnes et
// toggles déjà aplatis par Notion. Rien n'est inventé.
//
// Profil « agent » (accès agent, SPECS.md) : le Markdown d'un fichier du
// vault. Tableau pipe → tableau natif, adresse nue → lien, liste numérotée qui
// reprend → `start`, lien seul vers une page connue → bloc-lien sans pouvoir
// sur sa cible (`link: true`), image ou PDF distant → lien. Le profil
// « import », par défaut, reste celui de l'export Notion.

export type Styles = Record<string, boolean>;

export type InlineItem =
  | { type: "text"; text: string; styles: Styles }
  | { type: "link"; href: string; content: { type: "text"; text: string; styles: Styles }[] };

export type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: Block[];
};

export type ResolvedLink = { href: string; pageId: string; kind: "page" | "database" };

export type MarkdownContext = {
  newBlockId: () => string;
  // Lien interne connu (page ou base de l'archive) ; null pour un lien externe.
  resolveLink: (href: string) => ResolvedLink | null;
  // URL d'un média de l'archive, ou null s'il est absent.
  resolveMedia: (href: string) => string | null;
  onIgnored: (reason: string) => void;
  onConverted: (reason: string) => void;
  profile?: "import" | "agent";
};

export type ParsedMarkdown = { blocks: Block[] };

const DEFAULT_PROPS = { textColor: "default", textAlignment: "left", backgroundColor: "default" };
const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s|\s*<aside|\s*<details|\s*\|)/;

type ListKind = "bullet" | "numbered" | "check";

// content : colonne où commence le texte de l'élément ; une ligne en retrait
// d'au moins autant lui appartient (profil agent).
type ListLine = { indent: number; content: number; kind: ListKind; checked: boolean; number: number; text: string };

function textItem(text: string, styles: Styles = {}): InlineItem {
  return { type: "text", text, styles };
}

function toggle(styles: Styles, key: string): Styles {
  const next = { ...styles };
  if (next[key]) delete next[key];
  else next[key] = true;
  return next;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

function looksInternal(href: string): boolean {
  return href.startsWith("/") || /^https?:\/\//.test(href) || href.startsWith("mailto:");
}

// Un lien markdown : interne résolu, externe conservé, mort rendu en texte.
function linkItem(label: string, href: string, ctx: MarkdownContext, styles: Styles): InlineItem {
  const internal = ctx.resolveLink(href);
  const target = internal?.href ?? (looksInternal(href) ? href : null);
  if (!target) {
    ctx.onIgnored("lien sans cible dans l'archive");
    return textItem(label, styles);
  }
  const content = parseInline(label, ctx, styles).filter(
    (item): item is { type: "text"; text: string; styles: Styles } => item.type === "text",
  );
  return {
    type: "link",
    href: target,
    content: content.length > 0 ? content : [{ type: "text", text: label, styles }],
  };
}

// Emphases par bascule d'état, comme Markdown : ***gras italique*** se compose
// sans expression régulière. Le code est littéral ; les liens sont pris avant.
export function parseInline(text: string, ctx: MarkdownContext, inherited: Styles = {}): InlineItem[] {
  const items: InlineItem[] = [];
  let buffer = "";
  let styles: Styles = { ...inherited };
  const flush = () => {
    if (buffer !== "") {
      items.push(textItem(buffer, styles));
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length && "\\*_~`[]()!#".includes(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "!" && text[i + 1] === "[") {
      const image = readLinkAt(text, i + 1);
      if (image) {
        flush();
        const url = ctx.resolveMedia(image.href);
        if (!url) {
          ctx.onIgnored("image absente de l'archive");
          items.push(textItem(image.label || image.href, styles));
        } else {
          items.push(linkItem(image.label || url, url, ctx, styles));
        }
        i = image.end;
        continue;
      }
    }
    if (char === "[") {
      const link = readLinkAt(text, i);
      if (link) {
        flush();
        items.push(linkItem(link.label, link.href, ctx, styles));
        i = link.end;
        continue;
      }
    }
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        items.push(textItem(text.slice(i + 1, end), { ...styles, code: true }));
        i = end + 1;
        continue;
      }
    }
    if (char === "~" && text[i + 1] === "~") {
      flush();
      styles = toggle(styles, "strike");
      i += 2;
      continue;
    }
    if (char === "*" || char === "_") {
      // Un underscore dans un mot (snake_case) n'ouvre rien ; en fermeture,
      // l'état actif tranche.
      const opens = char === "*" || (!isWordChar(text[i - 1]) && !isWordChar(text[i + 1]));
      const closes = Boolean(styles.italic || styles.bold);
      if (opens || closes) {
        let run = 1;
        while (text[i + run] === char) run++;
        flush();
        if (run >= 3) {
          styles = toggle(styles, "bold");
          styles = toggle(styles, "italic");
          i += 3;
        } else if (run === 2) {
          styles = toggle(styles, "bold");
          i += 2;
        } else {
          styles = toggle(styles, "italic");
          i += 1;
        }
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
  return items.filter((item) => item.type === "link" || item.text !== "");
}

// Adresse nue dans le texte : sans la ponctuation qui la suit dans la phrase.
const BARE_URL = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?')\]»]/g;

// Profil agent : une adresse écrite telle quelle devient un lien. Le code et
// le texte d'un lien restent tels quels.
export function autolink(items: InlineItem[]): InlineItem[] {
  return items.flatMap((item): InlineItem[] => {
    if (item.type !== "text" || item.styles.code) return [item];
    const out: InlineItem[] = [];
    let last = 0;
    for (const match of item.text.matchAll(BARE_URL)) {
      const at = match.index ?? 0;
      if (at > last) out.push(textItem(item.text.slice(last, at), item.styles));
      out.push({ type: "link", href: match[0], content: [{ type: "text", text: match[0], styles: item.styles }] });
      last = at + match[0].length;
    }
    if (last === 0) return [item];
    if (last < item.text.length) out.push(textItem(item.text.slice(last), item.styles));
    return out;
  });
}

function inlineContent(text: string, ctx: MarkdownContext): InlineItem[] {
  const items = parseInline(text, ctx);
  return ctx.profile === "agent" ? autolink(items) : items;
}

function inlineBlock(type: string, text: string, ctx: MarkdownContext, props: Record<string, unknown> = {}): Block {
  return {
    id: ctx.newBlockId(),
    type,
    props: { ...DEFAULT_PROPS, ...props },
    content: inlineContent(text, ctx),
    children: [],
  };
}

function plainBlock(type: string, ctx: MarkdownContext, props: Record<string, unknown> = {}, content?: unknown): Block {
  return { id: ctx.newBlockId(), type, props: { ...props }, content, children: [] };
}

function stripHtml(line: string): string {
  return line.replace(/<[^>]*>/g, "");
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

// Profil agent : « \| » est une barre dans la cellule (lib/markdown_export.ts
// l'écrit ainsi), « <br> » un saut de ligne.
function splitEscapedRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n"));
}

// Tableau natif, comme celui que pose l'import HTML (notion-html.ts) : la
// ligne d'en-tête du Markdown est sa première ligne.
function tableBlock(rows: string[][], ctx: MarkdownContext): Block {
  const width = Math.max(...rows.map((row) => row.length));
  const cell = (text: string) => ({
    type: "tableCell",
    props: { ...DEFAULT_PROPS },
    content: inlineContent(text, ctx),
  });
  const content = {
    type: "tableContent",
    columnWidths: [],
    headerRows: 1,
    rows: rows.map((row) => ({ cells: Array.from({ length: width }, (_, i) => cell(row[i] ?? "")) })),
  };
  return { id: ctx.newBlockId(), type: "table", props: { textColor: "default" }, content, children: [] };
}

// Profil agent : une image ou un PDF distant reste un lien, plutôt que de
// perdre son adresse.
function remoteLinkBlock(label: string, href: string, ctx: MarkdownContext): Block | null {
  if (!/^https?:\/\//.test(href)) return null;
  ctx.onConverted("média distant laissé en lien");
  return {
    id: ctx.newBlockId(),
    type: "paragraph",
    props: { ...DEFAULT_PROPS },
    content: [{ type: "link", href, content: [textItem(label || href)] }],
    children: [],
  };
}

// Destination d'un lien : Notion laisse les parenthèses brutes dans les noms
// de fichiers (« WOOFLASH_presentation_(1).pdf »), une regex qui s'arrête à la
// première « ) » couperait le chemin. On lit donc jusqu'à la parenthèse
// équilibrée.
export function readLinkAt(text: string, start: number): { label: string; href: string; end: number } | null {
  if (text[start] !== "[") return null;
  const close = text.indexOf("](", start + 1);
  if (close === -1) return null;
  const label = text.slice(start + 1, close);
  if (label.includes("[") || label.includes("]")) return null;
  let depth = 1;
  let index = close + 2;
  while (index < text.length) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")") {
      depth--;
      if (depth === 0) break;
    }
    index++;
  }
  if (depth !== 0) return null;
  return { label, href: text.slice(close + 2, index), end: index + 1 };
}

// Ligne réduite à un seul lien ou une seule image.
export function standaloneLink(line: string): { image: boolean; label: string; href: string } | null {
  const imageAt = line.indexOf("![");
  const linkAt = line.indexOf("[");
  const image = imageAt !== -1 && (linkAt === -1 || imageAt <= linkAt);
  const start = image ? imageAt + 1 : linkAt;
  if (start === -1) return null;
  const parsed = readLinkAt(line, start);
  if (!parsed) return null;
  const before = image ? line.slice(0, start - 1) : line.slice(0, start);
  if (before.trim() !== "" || line.slice(parsed.end).trim() !== "") return null;
  return { image, label: parsed.label, href: parsed.href };
}

function readListLine(line: string): ListLine | null {
  const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!match) return null;
  const indent = match[1].replace(/\t/g, "  ").length;
  const content = indent + line.length - match[1].length - match[3].length;
  let kind: ListKind = /^\d+\.$/.test(match[2]) ? "numbered" : "bullet";
  const number = kind === "numbered" ? Number.parseInt(match[2], 10) : 0;
  let checked = false;
  let text = match[3];
  const check = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (check) {
    kind = "check";
    checked = check[1].toLowerCase() === "x";
    text = check[2];
  }
  return { indent, content, kind, checked, number, text };
}

type ListEntry = { indent: number; content: number; block: Block };

function leadingWidth(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "  ").length;
}

function dedent(line: string, width: number): string {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  const expanded = lead.replace(/\t/g, "  ");
  return expanded.slice(Math.min(width, expanded.length)) + line.slice(lead.length);
}

// Profil agent : une liste du vault est souvent aérée (lignes vides entre les
// éléments) et porte du texte en retrait sous un élément. La liste continue
// au-delà d'une ligne vide si une ligne de liste suit ; un passage en retrait
// d'au moins la colonne du texte d'un élément devient son enfant, converti par
// le même parseur (paragraphe, code clôturé, citation…).
function listContinuation(lines: string[], start: number, stack: ListEntry[], ctx: MarkdownContext): { index: number; line: ListLine | null } {
  let i = start;
  for (;;) {
    let j = i;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length) return { index: i, line: null };
    const listLine = readListLine(lines[j]);
    if (listLine) return { index: j, line: listLine };
    const width = leadingWidth(lines[j]);
    const owner = [...stack].reverse().find((entry) => width >= entry.content);
    if (!owner) return { index: i, line: null };
    const collected: string[] = [];
    let k = j;
    while (k < lines.length && (lines[k].trim() === "" || (leadingWidth(lines[k]) >= owner.content && !readListLine(lines[k])))) {
      collected.push(dedent(lines[k], owner.content));
      k++;
    }
    owner.block.children.push(...markdownToBlocks(collected.join("\n"), ctx).blocks);
    while (stack.length > 0 && stack[stack.length - 1] !== owner) stack.pop();
    i = k;
  }
}

export function markdownToBlocks(markdown: string, ctx: MarkdownContext): ParsedMarkdown {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Callout Notion : <aside>…</aside>, un emoji puis du texte.
    if (/^\s*<aside/i.test(line)) {
      const collected: string[] = [];
      i++;
      while (i < lines.length && !/<\/aside>/i.test(lines[i])) {
        collected.push(stripHtml(lines[i]));
        i++;
      }
      i++; // </aside>
      const text = collected.map((part) => part.trim()).filter(Boolean).join(" ").trim();
      if (text !== "") blocks.push(inlineBlock("quote", text, ctx));
      continue;
    }

    // Balises HTML sans équivalent (details/summary d'un export HTML malgré tout).
    if (/^\s*<details/i.test(line)) {
      ctx.onIgnored("bloc HTML sans équivalent");
      i++;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim() || "plain";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // clôture
      blocks.push(plainBlock("codeBlock", ctx, { language }, [textItem(code.join("\n"))]));
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(inlineBlock("heading", heading[2], ctx, { level: heading[1].length, isToggleable: false }));
      i++;
      continue;
    }
    if (/^#{4,6}\s+/.test(line)) {
      // Notion n'exporte pas au-delà de H3 ; un H4 tombe en H3.
      blocks.push(inlineBlock("heading", line.replace(/^#{4,6}\s+/, ""), ctx, { level: 3, isToggleable: false }));
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(plainBlock("divider", ctx));
      i++;
      continue;
    }

    if (ctx.profile === "agent" && /^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = [splitEscapedRow(line)];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitEscapedRow(lines[i]));
        i++;
      }
      blocks.push(tableBlock(rows, ctx));
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      let rows = 0;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = splitRow(lines[i]);
        blocks.push(inlineBlock("bulletListItem", cells.join(" · "), ctx));
        rows++;
        i++;
      }
      if (rows === 0) blocks.push(inlineBlock("paragraph", header.join(" · "), ctx));
      ctx.onConverted("tableau converti en liste");
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(inlineBlock("quote", quoted.join(" "), ctx));
      continue;
    }

    const list = readListLine(line);
    if (list) {
      const stack: ListEntry[] = [];
      let current: ListLine | null = list;
      while (current) {
        while (stack.length > 0 && current.indent <= stack[stack.length - 1].indent) stack.pop();
        const parent = stack.length > 0 ? stack[stack.length - 1].block : null;
        const type = current.kind === "check" ? "checkListItem" : current.kind === "numbered" ? "numberedListItem" : "bulletListItem";
        const props: Record<string, unknown> = current.kind === "check" ? { checked: current.checked } : {};
        // Profil agent : une liste numérotée qui ne suit pas une autre garde
        // son premier numéro (« 3. » après un bloc de code).
        const siblings = parent ? parent.children : blocks;
        if (ctx.profile === "agent" && type === "numberedListItem" && current.number > 1 && siblings.at(-1)?.type !== type) {
          props.start = current.number;
        }
        const block = inlineBlock(type, current.text, ctx, props);
        if (parent) parent.children.push(block);
        else blocks.push(block);
        stack.push({ indent: current.indent, content: current.content, block });
        i++;
        current = i < lines.length ? readListLine(lines[i]) : null;
        if (!current && ctx.profile === "agent") {
          const next = listContinuation(lines, i, stack, ctx);
          i = next.index;
          current = next.line;
        }
      }
      continue;
    }

    const standalone = standaloneLink(line);
    // Profil agent : un lien seul vers une page connue devient un bloc-lien,
    // jamais une sous-page possédée, dont l'effacement jetterait la cible.
    if (ctx.profile === "agent" && standalone && !standalone.image) {
      const target = ctx.resolveLink(standalone.href);
      if (target) {
        blocks.push(plainBlock("subpage", ctx, { pageId: target.pageId, kind: target.kind, link: true }));
        i++;
        continue;
      }
    }
    if (standalone?.image) {
      const url = ctx.resolveMedia(standalone.href);
      if (url) {
        blocks.push(
          plainBlock("image", ctx, {
            url,
            caption: standalone.label,
            previewWidth: 512,
            textAlignment: "left",
            backgroundColor: "default",
          }),
        );
      } else {
        const remote = ctx.profile === "agent" ? remoteLinkBlock(standalone.label, standalone.href, ctx) : null;
        if (!remote) ctx.onIgnored("image absente de l'archive");
        blocks.push(remote ?? inlineBlock("paragraph", standalone.label || standalone.href, ctx));
      }
      i++;
      continue;
    }

    if (standalone && /\.pdf(?:[?#]|$)/i.test(standalone.href)) {
      const url = ctx.resolveMedia(standalone.href);
      if (url) {
        blocks.push(plainBlock("file", ctx, { url, name: standalone.label, caption: "", backgroundColor: "default" }));
      } else {
        const remote = ctx.profile === "agent" ? remoteLinkBlock(standalone.label, standalone.href, ctx) : null;
        if (!remote) ctx.onIgnored("fichier absent de l'archive");
        blocks.push(remote ?? inlineBlock("paragraph", standalone.label, ctx));
      }
      i++;
      continue;
    }

    // Lien de sous-page seul sur sa ligne : bloc subpage, comme le menu « / ».
    if (standalone && /\.md(?:[?#]|$)/i.test(standalone.href)) {
      const target = ctx.resolveLink(standalone.href);
      if (target) {
        blocks.push(plainBlock("subpage", ctx, { pageId: target.pageId, kind: target.kind }));
      } else {
        blocks.push(inlineBlock("paragraph", standalone.label, ctx));
        ctx.onIgnored("sous-page hors de l'archive");
      }
      i++;
      continue;
    }

    // Paragraphe : lignes consécutives jusqu'à une ligne vide ou un nouveau bloc.
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    const text = paragraph.map((part) => part.trim()).join(" ");
    if (text !== "") blocks.push(inlineBlock("paragraph", text, ctx));
  }

  return { blocks };
}
