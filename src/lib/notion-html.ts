// Lecteur d'un export HTML de Notion : page → titre, icône, bandeau et blocs du
// schéma de l'éditeur. Module pur : liens, médias et bases sont résolus par un
// contexte injecté, les identifiants de bloc aussi, si bien qu'il se teste sans
// DOM réel ni archive.
//
// L'export HTML porte ce que le Markdown aplatit : dépliants (`details`),
// colonnes (`column-list`), tableaux, ordre des sous-pages. Rien n'est inventé :
// ce que le schéma ne sait pas lire est converti et signalé.
import { parse } from "parse5";
import {
  allElements,
  attr,
  children,
  elements,
  firstElement,
  hasClass,
  isElement,
  isText,
  normalizeSpace,
  styleValue,
  tagName,
  textContent,
  type DomElement,
  type DomNode,
} from "./html_dom";
import type { Block, InlineItem, ResolvedLink, Styles } from "./notion-markdown";
import { youtubeId } from "./youtube";

export type HtmlContext = {
  newBlockId: () => string;
  // Page hôte : les signets la portent pour que leurs médias suivent ses droits.
  pageId: string;
  // Lien interne connu (page ou base de l'archive) ; null pour un lien externe.
  resolveLink: (href: string) => ResolvedLink | null;
  // URL d'un média de l'archive, ou null s'il est absent.
  resolveMedia: (href: string) => string | null;
  // Base correspondant au tableau de collection courant, ou null. Le titre du
  // « collection-title » est fourni quand l'export en porte un.
  resolveCollection: (title: string) => string | null;
  onIgnored: (reason: string) => void;
  onConverted: (reason: string) => void;
};

export type HtmlIcon = { kind: "emoji"; emoji: string } | { kind: "image"; path: string };

export type HtmlPage = {
  title: string;
  icon: HtmlIcon | null;
  coverPath: string | null;
  coverPosition: number | null;
  blocks: Block[];
  // Ids Notion des sous-pages citées par des figures, dans l'ordre du corps.
  subpageIds: string[];
  // Images distantes laissées à rapatrier : le bloc qui les porte, la prop à
  // réécrire (« url » pour une image, « favicon » ou « image » d'un signet).
  remoteImages: { blockId: string; url: string; prop?: "url" | "favicon" | "image" }[];
};

type State = {
  ctx: HtmlContext;
  subpageIds: string[];
  remoteImages: { blockId: string; url: string; prop?: "url" | "favicon" | "image" }[];
  collectionTitle: string;
};

const DEFAULT_PROPS = { textColor: "default", textAlignment: "left", backgroundColor: "default" };
const HEADING = /^h([1-6])$/;

function makeBlock(
  ctx: HtmlContext,
  type: string,
  props: Record<string, unknown> = {},
  content?: unknown,
  blockChildren: Block[] = [],
): Block {
  const block: Block = { id: ctx.newBlockId(), type, props, children: blockChildren };
  if (content !== undefined) block.content = content;
  return block;
}

type TextItem = { type: "text"; text: string; styles: Styles };

function textItem(text: string, styles: Styles = {}): TextItem {
  // BlockNote refuse le mark « code » combiné à un autre : le code est
  // exclusif, on garde le code seul (une balise code dans du gras reste du code).
  return { type: "text", text, styles: styles.code ? { code: true } : styles };
}

function isTextItem(item: InlineItem): item is TextItem {
  return item.type === "text";
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function sameStyles(a: Styles, b: Styles): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (Boolean(a[key]) !== Boolean(b[key])) return false;
  return true;
}

// Contenu inline d'un nœud : texte, emphases, code et liens. Les éléments de
// bloc rencontrés dans un paragraphe (<p> dans un <li>) sont aplatis.
function inlineOf(nodes: DomNode[], ctx: HtmlContext, inherited: Styles = {}): InlineItem[] {
  const items: InlineItem[] = [];
  const push = (item: InlineItem) => {
    if (item.type === "text") {
      if (item.text === "") return;
      const last = items[items.length - 1];
      if (last && last.type === "text" && sameStyles(last.styles, item.styles)) {
        last.text += item.text;
        return;
      }
    }
    items.push(item);
  };

  for (const node of nodes) {
    if (isText(node)) {
      push(textItem(node.value.replace(/ /g, " "), inherited));
      continue;
    }
    if (!isElement(node)) continue;
    const tag = tagName(node);
    if (tag === "br") {
      push(textItem("\n", inherited));
      continue;
    }
    const style = (key: string) => ({ ...inherited, [key]: true });
    if (tag === "strong" || tag === "b") {
      for (const item of inlineOf(children(node), ctx, style("bold"))) push(item);
      continue;
    }
    if (tag === "em" || tag === "i") {
      for (const item of inlineOf(children(node), ctx, style("italic"))) push(item);
      continue;
    }
    if (tag === "u") {
      for (const item of inlineOf(children(node), ctx, style("underline"))) push(item);
      continue;
    }
    if (tag === "s" || tag === "strike" || tag === "del") {
      for (const item of inlineOf(children(node), ctx, style("strike"))) push(item);
      continue;
    }
    if (tag === "code") {
      for (const item of inlineOf(children(node), ctx, style("code"))) push(item);
      continue;
    }
    if (tag === "a") {
      const href = attr(node, "href") ?? "";
      const label = normalizeSpace(textContent(node));
      const internal = ctx.resolveLink(href);
      const target = internal?.href ?? (isExternal(href) ? href : null);
      if (!target) {
        if (label !== "") ctx.onIgnored("lien sans cible dans l'archive");
        for (const item of inlineOf(children(node), ctx, inherited)) push(item);
        continue;
      }
      const content = inlineOf(children(node), ctx, inherited).filter(isTextItem);
      push({
        type: "link",
        href: target,
        content: content.length > 0 ? content : [textItem(label, inherited)],
      });
      continue;
    }
    if (tag === "img") {
      // Une image seule dans un paragraphe est reconnue par le bloc appelant ;
      // ailleurs, le schéma n'a pas d'image en ligne.
      ctx.onIgnored("image dans un paragraphe");
      continue;
    }
    for (const item of inlineOf(children(node), ctx, inherited)) push(item);
  }
  return items;
}

function inlineText(nodes: DomNode[], ctx: HtmlContext): InlineItem[] {
  return inlineOf(nodes, ctx).filter((item) => item.type !== "text" || item.text.trim() !== "");
}

function isEmptyInline(items: InlineItem[]): boolean {
  return items.every((item) => item.type === "text" && normalizeSpace(item.text) === "");
}

// --- Blocs -----------------------------------------------------------------

function headingBlock(element: DomElement, ctx: HtmlContext): Block | null {
  const match = HEADING.exec(tagName(element));
  if (!match) return null;
  const level = Math.min(Number(match[1]), 3);
  const content = inlineText(children(element), ctx);
  if (isEmptyInline(content)) return null;
  return makeBlock(ctx, "heading", { ...DEFAULT_PROPS, level, isToggleable: false }, content);
}

function listBlocks(list: DomElement, state: State): Block[] {
  const { ctx } = state;
  const ordered = tagName(list) === "ol";
  const items = elements(list).filter((element) => tagName(element) === "li");
  const blocks: Block[] = [];
  for (const item of items) {
    const checkbox = firstElement(
      item,
      (element) => tagName(element) === "input" && (attr(element, "type") ?? "").toLowerCase() === "checkbox",
    );
    const nested = elements(item).filter((element) => ["ul", "ol"].includes(tagName(element)));
    const inlineNodes = children(item).filter((node) => !(isElement(node) && ["ul", "ol"].includes(tagName(node))));
    const content = inlineText(inlineNodes, ctx);
    const childrenBlocks = nested.flatMap((element) => listBlocks(element, state));
    const payload = isEmptyInline(content) ? [] : content;
    if (checkbox) {
      const checked = attr(checkbox, "checked") !== null;
      blocks.push(makeBlock(ctx, "checkListItem", { ...DEFAULT_PROPS, checked }, payload, childrenBlocks));
      continue;
    }
    blocks.push(
      makeBlock(ctx, ordered ? "numberedListItem" : "bulletListItem", { ...DEFAULT_PROPS }, payload, childrenBlocks),
    );
  }
  return blocks;
}

function toggleBlock(details: DomElement, state: State): Block {
  const { ctx } = state;
  const summary = firstElement(details, (element) => tagName(element) === "summary");
  const heading = summary ? firstElement(summary, (element) => HEADING.test(tagName(element))) : null;
  const titleNodes = heading ? children(heading) : summary ? children(summary) : [];
  const content = inlineText(titleNodes, ctx);
  // Le corps d'un dépliant est dans « div.indented » ; à défaut, tout ce qui
  // suit le résumé.
  const indented = firstElement(details, (element) => hasClass(element, "indented"));
  const bodyNodes = indented
    ? children(indented)
    : children(details).filter((node) => node !== summary && !(isElement(node) && tagName(node) === "summary"));
  const childrenBlocks = blocksOfNodes(bodyNodes, state);
  return makeBlock(
    ctx,
    "toggleListItem",
    { ...DEFAULT_PROPS },
    isEmptyInline(content) ? [] : content,
    childrenBlocks,
  );
}

function columnsBlock(list: DomElement, state: State): Block {
  const { ctx } = state;
  const columns = elements(list).filter((element) => hasClass(element, "column"));
  const childrenBlocks = columns.map((column) =>
    makeBlock(ctx, "column", {}, undefined, blocksOfNodes(children(column), state)),
  );
  return makeBlock(ctx, "columnList", {}, undefined, childrenBlocks);
}

function tableBlock(table: DomElement, ctx: HtmlContext): Block {
  // Toutes les lignes du tableau : thead, tbody et lignes nues.
  const rows = allElements(table, (element) => tagName(element) === "tr");
  const body = rows.map((row) => {
    const cells = elements(row).filter((element) => ["td", "th"].includes(tagName(element)));
    return {
      cells: cells.map((cell) => {
        const props: Record<string, unknown> = {
          textColor: "default",
          textAlignment: "left",
          backgroundColor: "default",
        };
        const colspan = Number(attr(cell, "colspan") ?? "1");
        const rowspan = Number(attr(cell, "rowspan") ?? "1");
        if (colspan > 1) props.colspan = colspan;
        if (rowspan > 1) props.rowspan = rowspan;
        return { type: "tableCell", props, content: inlineOf(children(cell), ctx) };
      }),
    };
  });
  const headerRows = rows.length > 0 && elements(rows[0]).some((cell) => tagName(cell) === "th") ? 1 : undefined;
  const content: Record<string, unknown> = { type: "tableContent", columnWidths: [], rows: body };
  if (headerRows === 1) content.headerRows = 1;
  return makeBlock(ctx, "table", { textColor: "default" }, content);
}

// Une image seule : locale, elle devient un média ; distante, elle est laissée
// à rapatrier (le bloc garde son URL en attendant).
function standaloneImage(src: string, state: State, caption = ""): Block | null {
  const { ctx } = state;
  const url = ctx.resolveMedia(src);
  if (url) {
    return makeBlock(ctx, "image", {
      url,
      name: src.slice(src.lastIndexOf("/") + 1),
      caption,
      showPreview: true,
    });
  }
  if (!/^https?:\/\//i.test(src)) {
    ctx.onIgnored("image absente de l'archive");
    return null;
  }
  const block = makeBlock(ctx, "image", {
    url: src,
    name: src.slice(src.lastIndexOf("/") + 1),
    caption,
    showPreview: true,
  });
  state.remoteImages.push({ blockId: block.id, url: src });
  return block;
}

function imageBlock(figure: DomElement, state: State): Block | null {
  const image = firstElement(figure, (element) => tagName(element) === "img");
  const src = image ? attr(image, "src") : null;
  if (!image || !src) {
    state.ctx.onIgnored("image sans source");
    return null;
  }
  const caption = firstElement(figure, (element) => tagName(element) === "figcaption");
  const block = standaloneImage(src, state, caption ? normalizeSpace(textContent(caption)) : "");
  if (!block) return null;
  const width = styleValue(attr(image, "style"), "width");
  if (width) {
    const value = Number.parseFloat(width);
    if (Number.isFinite(value) && value > 0) block.props.previewWidth = Math.round(value);
  }
  return block;
}

function fileBlock(figure: DomElement, ctx: HtmlContext): Block | null {
  const source = firstElement(figure, (element) => tagName(element) === "div" && hasClass(element, "source"));
  if (!source) return null;
  const link = firstElement(source, (element) => tagName(element) === "a");
  const href = link ? attr(link, "href") : null;
  if (!href) return null;
  const url = ctx.resolveMedia(href);
  if (url) {
    const label = normalizeSpace(textContent(source));
    const name = label.startsWith("attachment:")
      ? label.slice(label.lastIndexOf(":") + 1)
      : href.slice(href.lastIndexOf("/") + 1);
    return makeBlock(ctx, "file", { url, name, caption: "", backgroundColor: "default" });
  }
  if (youtubeId(href)) return makeBlock(ctx, "youtube", { url: href });
  if (isExternal(href)) {
    const label = normalizeSpace(textContent(source)) || href;
    return makeBlock(ctx, "paragraph", { ...DEFAULT_PROPS }, [
      { type: "link", href, content: [textItem(label, {})] },
    ]);
  }
  ctx.onIgnored("fichier absent de l'archive");
  return null;
}

function subpageBlock(figure: DomElement, state: State): Block | null {
  const { ctx } = state;
  const link = firstElement(figure, (element) => tagName(element) === "a");
  if (!link) return null;
  const href = attr(link, "href") ?? "";
  const notionId = attr(link, "data-notion-page-id");
  if (notionId) state.subpageIds.push(notionId);
  const resolved = ctx.resolveLink(href);
  if (!resolved) {
    const label = normalizeSpace(textContent(link));
    ctx.onIgnored("sous-page absente de l'archive");
    if (label === "") return null;
    return makeBlock(ctx, "paragraph", { ...DEFAULT_PROPS }, [textItem(label, {})]);
  }
  return makeBlock(ctx, "subpage", { pageId: resolved.pageId, kind: resolved.kind });
}

function bookmarkBlock(anchor: DomElement, state: State): Block | null {
  const { ctx } = state;
  const href = attr(anchor, "href") ?? "";
  if (!isExternal(href)) {
    ctx.onIgnored("signet sans adresse web");
    return null;
  }
  const text = (selector: string) => {
    const found = firstElement(anchor, (element) => hasClass(element, selector));
    return found ? normalizeSpace(textContent(found)) : "";
  };
  const imageOf = (selector: string) => {
    const found = firstElement(anchor, (element) => tagName(element) === "img" && hasClass(element, selector));
    return found ? (attr(found, "src") ?? "") : "";
  };
  const favicon = imageOf("bookmark-icon");
  const image = imageOf("bookmark-image");
  const block = makeBlock(ctx, "bookmark", {
    url: href,
    title: text("bookmark-title") || href,
    description: text("bookmark-description"),
    favicon: "",
    image: "",
    pageId: ctx.pageId,
  });
  // Les images du signet suivent la même hydratation que celles du corps.
  if (/^https?:\/\//i.test(favicon)) state.remoteImages.push({ blockId: block.id, url: favicon, prop: "favicon" });
  if (/^https?:\/\//i.test(image)) state.remoteImages.push({ blockId: block.id, url: image, prop: "image" });
  return block;
}

function collectionBlocks(table: DomElement, state: State): Block[] {
  const { ctx } = state;
  const databaseId = ctx.resolveCollection(state.collectionTitle);
  if (databaseId) return [makeBlock(ctx, "linked", { databaseId, config: "" })];
  ctx.onConverted("base sans CSV convertie en tableau");
  const blocks: Block[] = [];
  if (state.collectionTitle) {
    blocks.push(
      makeBlock(ctx, "heading", { ...DEFAULT_PROPS, level: 3, isToggleable: false }, [
        textItem(state.collectionTitle, {}),
      ]),
    );
  }
  blocks.push(tableBlock(table, ctx));
  return blocks;
}

function blocksOfNodes(nodes: DomNode[], state: State): Block[] {
  const { ctx } = state;
  const blocks: Block[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      const text = normalizeSpace(node.value);
      if (text !== "") blocks.push(makeBlock(ctx, "paragraph", { ...DEFAULT_PROPS }, [textItem(text, {})]));
      continue;
    }
    if (!isElement(node)) continue;
    const tag = tagName(node);
    if (tag === "script" || tag === "style" || tag === "link" || tag === "header" || tag === "br") continue;
    if (hasClass(node, "page-header-icon") || hasClass(node, "page-cover-image")) continue;

    if (HEADING.test(tag)) {
      if (hasClass(node, "collection-title")) {
        state.collectionTitle = normalizeSpace(textContent(node));
        continue;
      }
      const block = headingBlock(node, ctx);
      if (block) blocks.push(block);
      continue;
    }
    if (tag === "p") {
      const image = firstElement(node, (element) => tagName(element) === "img");
      if (image && elements(node).length === 1) {
        const src = attr(image, "src");
        const block = src ? standaloneImage(src, state) : null;
        if (block) blocks.push(block);
        continue;
      }
      const content = inlineText(children(node), ctx);
      if (!isEmptyInline(content)) blocks.push(makeBlock(ctx, "paragraph", { ...DEFAULT_PROPS }, content));
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      blocks.push(...listBlocks(node, state));
      continue;
    }
    if (tag === "details") {
      blocks.push(toggleBlock(node, state));
      continue;
    }
    if (hasClass(node, "column-list")) {
      blocks.push(columnsBlock(node, state));
      continue;
    }
    if (hasClass(node, "column") || hasClass(node, "indented")) {
      blocks.push(...blocksOfNodes(children(node), state));
      continue;
    }
    if (tag === "table") {
      if (hasClass(node, "collection-content")) {
        blocks.push(...collectionBlocks(node, state));
        continue;
      }
      if (hasClass(node, "properties")) continue;
      blocks.push(tableBlock(node, ctx));
      continue;
    }
    if (tag === "blockquote") {
      const content = inlineText(children(node), ctx);
      if (!isEmptyInline(content)) blocks.push(makeBlock(ctx, "quote", { ...DEFAULT_PROPS }, content));
      continue;
    }
    if (tag === "pre") {
      const code = firstElement(node, (element) => tagName(element) === "code") ?? node;
      const language = attr(code, "class")?.match(/language-([\w-]+)/)?.[1] ?? "";
      blocks.push(makeBlock(ctx, "codeBlock", { language }, [textItem(textContent(code), {})]));
      continue;
    }
    if (tag === "hr") {
      blocks.push(makeBlock(ctx, "divider", {}));
      continue;
    }
    if (tag === "figure") {
      if (hasClass(node, "image")) {
        const block = imageBlock(node, state);
        if (block) blocks.push(block);
        continue;
      }
      if (hasClass(node, "link-to-page")) {
        const block = subpageBlock(node, state);
        if (block) blocks.push(block);
        continue;
      }
      const bookmark = firstElement(node, (element) => hasClass(element, "bookmark"));
      if (bookmark) {
        const block = bookmarkBlock(bookmark, state);
        if (block) blocks.push(block);
        continue;
      }
      const source = firstElement(node, (element) => tagName(element) === "div" && hasClass(element, "source"));
      if (source) {
        const block = fileBlock(node, ctx);
        if (block) blocks.push(block);
        continue;
      }
      const nested = blocksOfNodes(children(node), state);
      if (nested.length > 0) blocks.push(...nested);
      else ctx.onIgnored("figure sans contenu reconnu");
      continue;
    }
    if (tag === "aside") {
      const content = inlineText(children(node), ctx);
      if (!isEmptyInline(content)) {
        ctx.onConverted("encadré converti en citation");
        blocks.push(makeBlock(ctx, "quote", { ...DEFAULT_PROPS }, content));
      }
      continue;
    }
    if (tag === "img") {
      const src = attr(node, "src");
      const block = src ? standaloneImage(src, state) : null;
      if (block) blocks.push(block);
      continue;
    }
    if (tag === "a" && hasClass(node, "bookmark")) {
      const block = bookmarkBlock(node, state);
      if (block) blocks.push(block);
      continue;
    }
    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      const bookmark = firstElement(node, (element) => hasClass(element, "bookmark"));
      if (bookmark) {
        const block = bookmarkBlock(bookmark, state);
        if (block) blocks.push(block);
        continue;
      }
      blocks.push(...blocksOfNodes(children(node), state));
      continue;
    }
    // Texte brut ou balise inconnue : son contenu inline, s'il en porte.
    const content = inlineText([node], ctx);
    if (!isEmptyInline(content)) blocks.push(makeBlock(ctx, "paragraph", { ...DEFAULT_PROPS }, content));
    else ctx.onIgnored(`bloc HTML non reconnu : ${tag || "texte"}`);
  }
  return blocks;
}

// --- Page ------------------------------------------------------------------

function coverPositionOf(value: string | null): number | null {
  if (!value) return null;
  const match = /(?:center\s+)?(-?\d+(?:\.\d+)?)%/.exec(value);
  if (!match) return null;
  const position = Math.min(100, Math.max(0, Math.round(Number(match[1]))));
  return Number.isFinite(position) ? position : null;
}

function iconOf(header: DomNode): HtmlIcon | null {
  const span = firstElement(header, (element) => tagName(element) === "span" && attr(element, "data-emoji") !== null);
  if (span) {
    const emoji = attr(span, "data-emoji")?.trim() ?? "";
    return emoji ? { kind: "emoji", emoji } : null;
  }
  const image = firstElement(header, (element) => tagName(element) === "img" && hasClass(element, "icon"));
  const src = image ? attr(image, "src") : null;
  return src ? { kind: "image", path: src } : null;
}

export function htmlToPage(html: string, ctx: HtmlContext): HtmlPage {
  const document = parse(html);
  const article = firstElement(document, (element) => tagName(element) === "article");
  const root: DomNode = article ?? document;
  const header = firstElement(root, (element) => tagName(element) === "header");
  const body = firstElement(root, (element) => tagName(element) === "div" && hasClass(element, "page-body"));

  const titleElement = firstElement(root, (element) => tagName(element) === "h1" && hasClass(element, "page-title"));
  const documentTitle = firstElement(document, (element) => tagName(element) === "title");
  const title = normalizeSpace(
    titleElement ? textContent(titleElement) : documentTitle ? textContent(documentTitle) : "",
  );

  const cover = header
    ? firstElement(header, (element) => tagName(element) === "img" && hasClass(element, "page-cover-image"))
    : null;
  const coverPath = cover ? attr(cover, "src") : null;
  const coverPosition = coverPositionOf(cover ? styleValue(attr(cover, "style"), "object-position") : null);

  const state: State = { ctx, subpageIds: [], remoteImages: [], collectionTitle: "" };
  const blocks = body ? blocksOfNodes(children(body), state) : blocksOfNodes(children(root), state);

  return {
    // Vide quand l'export ne porte ni « h1.page-title » ni « title » : le plan
    // retombe alors sur le nom de fichier, jamais sur un titre inventé.
    title,
    icon: header ? iconOf(header) : null,
    coverPath,
    coverPosition,
    blocks,
    subpageIds: state.subpageIds,
    remoteImages: state.remoteImages,
  };
}
