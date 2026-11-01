// Corps BlockNote (jsonb) → texte brut, pour alimenter body_text et donc la
// recherche ; → HTML, pour la vue publique ; ajout de blocs lors d'un
// déplacement d'entrée ; blocs-liens vers les sous-pages.
//
// Le corps arrive du navigateur : on le parcourt sans lui faire confiance,
// chaque champ inattendu est simplement ignoré.
import { iconSrc, resolveIcon } from "./icons";
import type { Orphan } from "./properties";
import { isStoredName } from "./upload_rules";
import { youtubeEmbedUrl, youtubeId } from "./youtube";

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Contenu en ligne : texte simple, ou lien qui contient lui-même du texte.
function inlineText(content: Json): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isObject(item)) return "";
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "link") return inlineText(item.content);
      return "";
    })
    .join("");
}

// Tableau : rows[].cells[], chaque cellule étant du contenu en ligne, nu ou
// enveloppé dans { type: "tableCell", content }.
function tableText(content: Record<string, Json>): string[] {
  if (!Array.isArray(content.rows)) return [];
  return content.rows.flatMap((row) => {
    if (!isObject(row) || !Array.isArray(row.cells)) return [];
    return row.cells.map((cell) => inlineText(isObject(cell) ? cell.content : cell));
  });
}

function blockLines(block: Json): string[] {
  if (!isObject(block)) return [];
  const lines: string[] = [];
  const { content, props } = block;
  if (isObject(content) && content.type === "tableContent") lines.push(...tableText(content));
  else lines.push(inlineText(content));
  // Nom et légende d'un fichier ou d'une image : retrouver « grille.pdf ».
  if (isObject(props)) {
    for (const key of ["name", "caption"] as const) {
      if (typeof props[key] === "string") lines.push(props[key]);
    }
  }
  if (Array.isArray(block.children)) lines.push(...block.children.flatMap(blockLines));
  return lines;
}

export function flattenToText(body: Json): string {
  if (!Array.isArray(body)) return "";
  return body
    .flatMap(blockLines)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Un paragraphe par valeur orpheline : « URL : » suivi d'un lien cliquable
// pour une adresse, le texte nu pour les autres. Le nom de la propriété reste
// visible, sans quoi la valeur flotterait sans dire d'où elle vient.
function orphanBlock(orphan: Orphan) {
  const content =
    orphan.type === "url"
      ? [
          { type: "text", text: `${orphan.name} : `, styles: {} },
          { type: "link", href: orphan.text, content: [{ type: "text", text: orphan.text, styles: {} }] },
        ]
      : [{ type: "text", text: `${orphan.name} : ${orphan.text}`, styles: {} }];
  return {
    id: globalThis.crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", textAlignment: "left", backgroundColor: "default" },
    content,
    children: [],
  };
}

// Corps d'une entrée déplacée : le corps reçu, suivi des valeurs qui n'ont pas
// trouvé de propriété d'accueil dans la base cible.
export function appendOrphans(body: Json, orphans: readonly Orphan[]): Json[] {
  const blocks: Json[] = Array.isArray(body) ? [...body] : [];
  for (const orphan of orphans) blocks.push(orphanBlock(orphan));
  return blocks;
}

// --- Listes de colonnes ---------------------------------------------------------
//
// Deux blocs de mise en page, sans contenu propre : « columnList » tient deux à
// quatre « column », chacune tenant des blocs ordinaires. BlockNote dissout une
// liste réduite à une colonne (son contenu remonte à sa place) et retire une
// colonne dont il ne reste qu'un paragraphe vide.

export const COLUMNS_MIN = 2;
export const COLUMNS_MAX = 4;

// Ce que le menu « / » pose : une liste de `count` colonnes, chacune habitée
// d'un paragraphe vide où le curseur peut se loger.
export function columnStructure(count: number) {
  const columns = Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.trunc(count)));
  return {
    type: "columnList" as const,
    children: Array.from({ length: columns }, () => ({
      type: "column" as const,
      children: [{ type: "paragraph" as const }],
    })),
  };
}

const MEDIA_BLOCKS = new Set(["image", "file", "youtube"]);

// Une colonne « pèse » si elle porte du texte, un média pourvu d'une adresse,
// un bloc-lien vers une page, ou un séparateur. Retirer une colonne vide ne
// demande donc pas de confirmation.
export function columnHasContent(block: Json): boolean {
  if (!isObject(block)) return false;
  const props = propsOf(block);
  if (typeof block.type === "string") {
    if (MEDIA_BLOCKS.has(block.type)) return typeof props.url === "string" && props.url.trim() !== "";
    if (block.type === SUBPAGE_BLOCK) return typeof props.pageId === "string" && props.pageId !== "";
    if (block.type === LINKED_BLOCK) return typeof props.databaseId === "string" && props.databaseId !== "";
    if (block.type === "divider") return true;
  }
  const { content } = block;
  if (isObject(content) && content.type === "tableContent") {
    if (tableText(content).some((cell) => cell.trim())) return true;
  } else if (inlineText(content).trim()) {
    return true;
  }
  return childrenOf(block).some(columnHasContent);
}

// Un corps « pèse » si l'un de ses blocs pèse, au même sens : la suspension
// automatique compte un corps qui pesait et ne pèse plus (sync_client_plan.ts).
export function bodyHasContent(body: Json): boolean {
  return Array.isArray(body) && body.some(columnHasContent);
}

// --- Blocs-liens vers les sous-pages --------------------------------------------
//
// Une sous-page créée par le menu « / » laisse dans le corps de sa mère un bloc
// « subpage » qui ne garde que son id. Effacer le dernier bloc d'une sous-page
// l'envoie en corbeille ; le voir revenir (Ctrl + Z, collage) la restaure.

export const SUBPAGE_BLOCK = "subpage";

// Nombre de blocs-liens par sous-page, enfants compris. Un bloc en attente
// (id vide, création en cours) ne compte pas.
export function subpageRefs(body: Json): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (blocks: Json) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isObject(block)) continue;
      const pageId = isObject(block.props) ? block.props.pageId : undefined;
      if (block.type === SUBPAGE_BLOCK && typeof pageId === "string" && pageId) {
        counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
      }
      visit(block.children);
    }
  };
  visit(body);
  return counts;
}

// Sous-pages dont le dernier bloc vient de disparaître, et celles qui
// retrouvent un bloc. Un bloc déplacé ou dupliqué ne change rien.
export function refChanges(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): { gone: string[]; back: string[] } {
  return {
    gone: [...before.keys()].filter((id) => !after.has(id)),
    back: [...after.keys()].filter((id) => !before.has(id)),
  };
}

// --- Vues liées ----------------------------------------------------------------
//
// Un bloc « linked » montre une base existante avec des vues propres au bloc
// (lib/views.ts, parseLinkedConfig). Le bloc ne garde que l'id de la base et
// son texte de vues : rien de la base source n'est recopié.

export const LINKED_BLOCK = "linked";

export type LinkedRef = { databaseId: string; config: unknown };

// Vues liées d'un corps, récursivement (colonnes comprises). Un bloc encore
// vide (base non choisie) ne compte pas.
export function linkedRefs(body: Json): LinkedRef[] {
  const refs: LinkedRef[] = [];
  const visit = (blocks: Json) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isObject(block)) continue;
      const props = propsOf(block);
      if (block.type === LINKED_BLOCK && typeof props.databaseId === "string" && props.databaseId) {
        refs.push({ databaseId: props.databaseId, config: props.config });
      }
      visit(block.children);
    }
  };
  visit(body);
  return refs;
}

// --- Rendu HTML de la vue publique -------------------------------------------
//
// Le HTML produit est injecté tel quel dans la page publique : tout texte est
// échappé, toute adresse filtrée, toute classe prise dans une liste fermée.

const COLORS = new Set(["gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const ALIGNMENTS = new Set(["center", "right", "justify"]);
const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

// Adresse admise dans un lien : web, courriel, ou chemin du site. Tout le
// reste (javascript:, data:, //autre-hôte, que le navigateur lit comme un
// autre site) est refusé.
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (/^\/(?![/\\])/.test(href)) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Source d'une image ou d'un fichier : un média déposé, ou une adresse web.
function safeSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const media = raw.match(/^\/api\/media\/([^/?#]+)$/);
  if (media) return isStoredName(media[1]) ? raw : null;
  const href = safeHref(raw);
  return href && /^https?:/.test(href) ? href : null;
}

function linkAttrs(href: string): string {
  const external = /^https?:/.test(href) || href.startsWith("/api/media/");
  return `href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}`;
}

function colorClasses(record: Record<string, Json>): string[] {
  const classes: string[] = [];
  if (typeof record.textColor === "string" && COLORS.has(record.textColor)) classes.push(`tc-${record.textColor}`);
  if (typeof record.backgroundColor === "string" && COLORS.has(record.backgroundColor)) classes.push(`bg-${record.backgroundColor}`);
  return classes;
}

function styledText(text: string, styles: Record<string, Json>): string {
  let html = escapeHtml(text).replace(/\n/g, "<br>");
  if (styles.code === true) html = `<code>${html}</code>`;
  if (styles.strike === true) html = `<s>${html}</s>`;
  if (styles.underline === true) html = `<u>${html}</u>`;
  if (styles.italic === true) html = `<em>${html}</em>`;
  if (styles.bold === true) html = `<strong>${html}</strong>`;
  const classes = colorClasses(styles);
  return classes.length ? `<span class="${classes.join(" ")}">${html}</span>` : html;
}

function inlineHtml(content: Json): string {
  if (typeof content === "string") return styledText(content, {});
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return styledText(item, {});
      if (!isObject(item)) return "";
      if (item.type === "text" && typeof item.text === "string") {
        return styledText(item.text, isObject(item.styles) ? item.styles : {});
      }
      if (item.type === "link") {
        const inner = inlineHtml(item.content);
        const href = safeHref(item.href);
        return href ? `<a ${linkAttrs(href)}>${inner}</a>` : inner;
      }
      return "";
    })
    .join("");
}

// Classes d'un bloc : alignement et couleurs, chacun pris dans sa liste.
function blockAttrs(props: Record<string, Json>, extra: string[] = []): string {
  const classes = [...extra];
  if (typeof props.textAlignment === "string" && ALIGNMENTS.has(props.textAlignment)) {
    classes.push(`align-${props.textAlignment}`);
  }
  classes.push(...colorClasses(props));
  return classes.length ? ` class="${classes.join(" ")}"` : "";
}

// Lien d'un bloc de sous-page dans la vue publique ; null : la sous-page n'est
// pas lisible par ce lien (corbeille, déplacée hors du sous-arbre), le bloc
// disparaît.
export type SubpageLink = { href: string; title: string; icon: string | null; type?: string };
export type RenderOptions = {
  subpage?: (pageId: string) => SubpageLink | null;
  // HTML d'une vue liée, calculé à part : il demande les entrées de la base
  // source. Absent : le bloc ne rend rien (écran de sauvegarde, par exemple).
  linked?: (databaseId: string, config: unknown) => string | null;
};

// Double HTML de PageIcon (components/PageIcon.tsx) pour le corps public.
export function iconHtml(icon: string | null, type?: string): string {
  const resolved = resolveIcon(icon, type);
  if (resolved.kind === "image") {
    return `<img class="page-icon page-icon-img" src="${escapeHtml(iconSrc(resolved.filename))}" alt="" aria-hidden="true">`;
  }
  return `<span class="page-icon" aria-hidden="true">${escapeHtml(resolved.emoji)}</span>`;
}

const LISTS: Record<string, { tag: "ul" | "ol"; extra: string[] }> = {
  bulletListItem: { tag: "ul", extra: [] },
  numberedListItem: { tag: "ol", extra: [] },
  checkListItem: { tag: "ul", extra: ["checklist"] },
};

function propsOf(block: Record<string, Json>): Record<string, Json> {
  return isObject(block.props) ? block.props : {};
}

function childrenOf(block: Record<string, Json>): Json[] {
  return Array.isArray(block.children) ? block.children : [];
}

function listItemHtml(block: Record<string, Json>, options: RenderOptions): string {
  const props = propsOf(block);
  const nested = blocksHtml(childrenOf(block), options);
  if (block.type === "checkListItem") {
    const checked = props.checked === true;
    const box = `<input type="checkbox" disabled${checked ? " checked" : ""} aria-label="${checked ? "Cochée" : "Non cochée"}">`;
    return `<li${blockAttrs(props, checked ? ["checked"] : [])}>${box} ${inlineHtml(block.content)}${nested}</li>`;
  }
  return `<li${blockAttrs(props)}>${inlineHtml(block.content)}${nested}</li>`;
}

function captionHtml(props: Record<string, Json>): string {
  return typeof props.caption === "string" && props.caption ? `<figcaption>${escapeHtml(props.caption)}</figcaption>` : "";
}

function blockHtml(block: Json, options: RenderOptions): string {
  if (!isObject(block)) return "";
  const props = propsOf(block);
  const children = childrenOf(block);
  const nested = children.length ? `<div class="block-children">${blocksHtml(children, options)}</div>` : "";
  switch (block.type) {
    case "paragraph":
      return `<p${blockAttrs(props)}>${inlineHtml(block.content)}</p>${nested}`;
    case "heading": {
      // Le titre de la page est le h1 : un titre de niveau 1 du corps est un h2.
      const level = typeof props.level === "number" && props.level >= 1 ? Math.min(Math.floor(props.level) + 1, 6) : 2;
      const heading = `<h${level}${blockAttrs(props)}>${inlineHtml(block.content)}</h${level}>`;
      return props.isToggleable === true ? `<details><summary>${heading}</summary>${blocksHtml(children, options)}</details>` : heading + nested;
    }
    case "quote":
      return `<blockquote${blockAttrs(props)}>${inlineHtml(block.content)}</blockquote>${nested}`;
    case "toggleListItem":
      return `<details${blockAttrs(props)}><summary>${inlineHtml(block.content)}</summary>${blocksHtml(children, options)}</details>`;
    case "codeBlock":
      // Le code s'affiche tel qu'écrit : ni style ni lien.
      return `<pre><code>${escapeHtml(inlineText(block.content))}</code></pre>${nested}`;
    case "divider":
      return "<hr>";
    case "image": {
      const src = safeSrc(props.url);
      if (!src) return "";
      const alt = typeof props.caption === "string" && props.caption ? props.caption : typeof props.name === "string" ? props.name : "";
      const width = typeof props.previewWidth === "number" && props.previewWidth > 0 ? ` style="width:${Math.round(props.previewWidth)}px"` : "";
      return `<figure class="media-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${width}>${captionHtml(props)}</figure>`;
    }
    case "file": {
      const src = safeSrc(props.url);
      if (!src) return "";
      const name = typeof props.name === "string" && props.name ? props.name : "Fichier";
      return `<p class="media-file"><a ${linkAttrs(src)}>${escapeHtml(name)}</a></p>${captionHtml(props)}`;
    }
    case SUBPAGE_BLOCK: {
      const pageId = typeof props.pageId === "string" ? props.pageId : "";
      const link = pageId && options.subpage ? options.subpage(pageId) : null;
      if (!link) return "";
      const label = `${iconHtml(link.icon, link.type)} ${escapeHtml(link.title || "Sans titre")}`;
      return `<p class="subpage-link"><a href="${escapeHtml(link.href)}">${label}</a></p>`;
    }
    case "youtube": {
      const id = typeof props.url === "string" ? youtubeId(props.url) : null;
      if (!id) return "";
      return (
        `<div class="yt-embed"><iframe src="${youtubeEmbedUrl(id)}" title="Vidéo YouTube" loading="lazy"` +
        ' allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen' +
        ' referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
      );
    }
    case LINKED_BLOCK: {
      const databaseId = typeof props.databaseId === "string" ? props.databaseId : "";
      return databaseId && options.linked ? (options.linked(databaseId, props.config) ?? "") : "";
    }
    case "conflict":
      // Encadré de fusion (lib/sync_merge.ts) : un brouillon à trier dans
      // l'éditeur, jamais montré au lecteur de la vue publique.
      return "";
    case "columnList":
      return `<div class="body-columns">${blocksHtml(children, options)}</div>`;
    case "column":
      return `<div class="body-column">${blocksHtml(children, options)}</div>`;
    default: {
      // Bloc inconnu (tableau importé, type futur) : son texte, s'il en a.
      const { content } = block;
      if (isObject(content) && content.type === "tableContent") {
        const rows = Array.isArray(content.rows) ? content.rows : [];
        const body = rows
          .map((row) => {
            const cells = isObject(row) && Array.isArray(row.cells) ? row.cells : [];
            return `<tr>${cells.map((cell) => `<td>${inlineHtml(isObject(cell) ? cell.content : cell)}</td>`).join("")}</tr>`;
          })
          .join("");
        return `<table class="body-table"><tbody>${body}</tbody></table>`;
      }
      const inner = inlineHtml(content);
      return inner ? `<p>${inner}</p>${nested}` : nested;
    }
  }
}

// Les éléments de liste consécutifs de même type forment une seule liste.
function blocksHtml(blocks: Json[], options: RenderOptions): string {
  let html = "";
  let i = 0;
  while (i < blocks.length) {
    const first = blocks[i];
    const list = isObject(first) && typeof first.type === "string" ? LISTS[first.type] : undefined;
    if (!list || !isObject(first)) {
      html += blockHtml(first, options);
      i++;
      continue;
    }
    let items = "";
    while (i < blocks.length) {
      const item = blocks[i];
      if (!isObject(item) || item.type !== first.type) break;
      items += listItemHtml(item, options);
      i++;
    }
    const start = propsOf(first).start;
    const startAttr = first.type === "numberedListItem" && typeof start === "number" && start > 1 ? ` start="${Math.floor(start)}"` : "";
    const classAttr = list.extra.length ? ` class="${list.extra.join(" ")}"` : "";
    html += `<${list.tag}${classAttr}${startAttr}>${items}</${list.tag}>`;
  }
  return html;
}

export function renderHtml(body: Json, options: RenderOptions = {}): string {
  return Array.isArray(body) ? blocksHtml(body, options) : "";
}
