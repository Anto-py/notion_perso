// Rendu d'une vue liée hors de l'éditeur : vue publique et écran de
// sauvegarde, qui ne diffèrent que par leurs liens et leur base de médias.
// Le HTML est injecté tel quel : tout texte est échappé, toute adresse filtrée.
//
// La vue liée se lit selon sa vue active, comme dans l'app ; une Galerie se
// rend en galerie, tout le reste en tableau (même règle que la vue publique
// d'une base, BRAINSTORMING §4).
import { escapeHtml, iconHtml, safeHref } from "./blocks";
import { MEDIA_BASE } from "./icons";
import {
  dateText,
  dateTimeText,
  formatNumber,
  normalizeValue,
  optionById,
  type EntryRow,
  type LinkRef,
  type Property,
} from "./properties";
import { cardImage, type View } from "./views";

// Base source non publiée, vue liée lue par un lien public : ni titre ni
// entrée de la base, l'encart seul.
export const LINKED_PRIVATE_HTML = '<div class="linked-block linked-private">Contenu privé</div>';

export type LinkedHtmlOptions = {
  // Lien vers l'entrée ; la base source en fournit la racine publique.
  href: (entryId: string) => string;
  // Base des médias, pour l'écran de sauvegarde (quarantaine comprise).
  mediaBase?: string;
  // Lien vers la base elle-même, si elle est lisible par ce lien.
  baseHref?: string | null;
  // Lien d'une puce de relation ; null : le titre seul, sans lien.
  entryLink?: (ref: LinkRef) => string | null;
};

// Une valeur de propriété, en HTML. Double volontaire de ValueView
// (components/propertyUi.tsx), que le rendu en chaîne ne peut pas appeler.
function valueHtml(prop: Property, raw: unknown, refs: readonly LinkRef[] | undefined, options: LinkedHtmlOptions): string {
  const value = normalizeValue(prop, raw);
  if (prop.type === "checkbox") return value ? "☑" : "☐";
  if (value === undefined) return "";
  switch (prop.type) {
    case "relation":
      // Les puces d'une relation, dans l'ordre de la valeur ; une entrée en
      // corbeille disparaît, un titre jamais publié reste en texte.
      return (value as string[])
        .flatMap((id) => {
          const ref = refs?.find((item) => item.id === id);
          return ref && !ref.trashed ? [ref] : [];
        })
        .map((ref) => {
          const href = options.entryLink ? options.entryLink(ref) : null;
          const label = `${iconHtml(ref.icon, "entry")} ${escapeHtml(ref.title || "Sans titre")}`;
          return href ? `<a href="${escapeHtml(href)}" class="chip chip-link">${label}</a>` : `<span class="chip chip-link">${label}</span>`;
        })
        .join(" ");
    case "select": {
      const option = optionById(prop, value as string);
      return option ? `<span class="chip chip-${escapeHtml(option.color)}">${escapeHtml(option.name)}</span>` : "";
    }
    case "multiselect":
      return (value as string[])
        .map((id) => {
          const option = optionById(prop, id);
          return option ? `<span class="chip chip-${escapeHtml(option.color)}">${escapeHtml(option.name)}</span>` : "";
        })
        .join(" ");
    case "date":
      return escapeHtml(dateText(value as string));
    case "number":
      return `<span class="number-view">${escapeHtml(formatNumber(value as number, prop.format))}</span>`;
    case "created_time":
    case "updated_time":
      return `<span class="time-view">${escapeHtml(dateTimeText(value as string))}</span>`;
    case "url": {
      const href = safeHref(value);
      if (!href) return escapeHtml(String(value));
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="url-view">${escapeHtml(
        String(value).replace(/^https?:\/\/(www\.)?/i, ""),
      )}</a>`;
    }
    default:
      return escapeHtml(String(value));
  }
}

function mediaSrc(url: string, mediaBase: string): string {
  return escapeHtml(mediaBase === MEDIA_BASE ? url : url.replaceAll(MEDIA_BASE, mediaBase));
}

function entryLabel(entry: EntryRow): string {
  return `${iconHtml(entry.icon, "entry")} ${escapeHtml(entry.title || "Sans titre")}`;
}

export function linkedViewHtml(
  base: { title: string; icon: string | null },
  entries: readonly EntryRow[],
  properties: readonly Property[],
  view: View,
  options: LinkedHtmlOptions,
): string {
  const mediaBase = options.mediaBase ?? MEDIA_BASE;
  const heading = options.baseHref
    ? `<p class="linked-head"><a href="${escapeHtml(options.baseHref)}">${iconHtml(base.icon, "database")} ${escapeHtml(
        base.title || "Sans titre",
      )}</a></p>`
    : `<p class="linked-head">${iconHtml(base.icon, "database")} ${escapeHtml(base.title || "Sans titre")}</p>`;
  if (entries.length === 0) return `<div class="linked-block">${heading}<p class="hint">Aucune entrée.</p></div>`;

  if (view.kind === "gallery") {
    const cards = entries
      .map((entry) => {
        const image = cardImage(entry);
        const picture = image
          ? `<img src="${mediaSrc(image, mediaBase)}" alt=${view.show_title ? '""' : `"${escapeHtml(entry.title)}"`} loading="lazy">`
          : `<span class="gallery-fallback">${iconHtml(entry.icon, "entry")}</span>`;
        const title = view.show_title ? `<span class="gallery-title">${entryLabel(entry)}</span>` : "";
        return `<li><a href="${escapeHtml(options.href(entry.id))}" class="gallery-card"><span class="gallery-image">${picture}</span>${title}</a></li>`;
      })
      .join("");
    return `<div class="linked-block">${heading}<ul class="gallery-grid public-gallery gallery-${view.card_size}">${cards}</ul></div>`;
  }

  const columns = properties.filter((prop) => !view.hidden.includes(prop.id));
  const head = columns.map((prop) => `<th scope="col">${escapeHtml(prop.name)}</th>`).join("");
  const rows = entries
    .map((entry) => {
      const cells = columns.map((prop) => `<td>${valueHtml(prop, entry.values[prop.id], entry.links?.[prop.id], options)}</td>`).join("");
      return `<tr><td class="cell-title"><a href="${escapeHtml(options.href(entry.id))}">${entryLabel(entry)}</a></td>${cells}</tr>`;
    })
    .join("");
  return (
    `<div class="linked-block">${heading}<div class="table-wrap"><table class="db-table public-table">` +
    `<thead><tr><th scope="col">Titre</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}
