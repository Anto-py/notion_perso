// Gestes du visiteur sur une base publique (BRAINSTORMING §7) : chercher par
// le titre, filtrer et trier, sans rien écrire. Ce module prépare ce que le
// navigateur reçoit, puis applique ses gestes ; tout est pur.
//
// Ce qui part vers le navigateur est lisible par tous : seules les colonnes
// affichées voyagent, jamais les valeurs masquées ni les filtres de la vue.
import {
  TITLE_PROP,
  filterOpsFor,
  fold,
  matchesFilters,
  optionById,
  sortEntries,
  type EntryRow,
  type Filter,
  type LinkRef,
  type Property,
  type SelectOption,
  type Sort,
} from "./properties";
import type { CardSize, View } from "./views";

// Horodatage neutre quand aucune colonne n'en a besoin : le vrai n'est pas
// affiché, il ne voyage pas.
const NO_TIME = "1970-01-01T00:00:00.000Z";

export type PublicViewShape = {
  kind: "table" | "gallery";
  cardSize: CardSize;
  showTitle: boolean;
  // Figeage de la première colonne et de la ligne d'en-tête : suit la vue
  // publiée, pour que le visiteur garde les repères d'un long tableau.
  frozenFirstColumn: boolean;
  frozenHeader: boolean;
};

export type PublicDatabaseData = {
  view: PublicViewShape;
  // Colonnes affichées, dans l'ordre du schéma. Vide pour une Galerie, qui
  // ne montre que images et titres.
  columns: Property[];
  // Entrées déjà filtrées par la vue et la portée, dans l'ordre de la vue.
  entries: EntryRow[];
  entryHref: Record<string, string>;
  // Lien d'une puce de relation ; null : le titre seul.
  chipHref: Record<string, string | null>;
  mediaBase: string;
};

export type VisitorState = { query: string; filters: Filter[]; sorts: Sort[] };

export const EMPTY_VISITOR: VisitorState = { query: "", filters: [], sorts: [] };

// Un Kanban, une Liste ou un Calendrier se lisent en tableau (BRAINSTORMING §4).
export function publicShape(view: View): PublicViewShape {
  return {
    kind: view.kind === "gallery" ? "gallery" : "table",
    cardSize: view.card_size,
    showTitle: view.show_title,
    frozenFirstColumn: view.frozen_first_column,
    frozenHeader: view.frozen_header,
  };
}

export function shownColumns(properties: readonly Property[], view: View): Property[] {
  return view.kind === "gallery" ? [] : properties.filter((prop) => !view.hidden.includes(prop.id));
}

export function publicDatabaseData(
  entries: readonly EntryRow[],
  properties: readonly Property[],
  view: View,
  links: { href: (id: string) => string; chip: (ref: LinkRef) => string | null; mediaBase: string },
): PublicDatabaseData {
  const shape = publicShape(view);
  const columns = shownColumns(properties, view);
  const shown = new Set(columns.map((prop) => prop.id));
  const created = columns.some((prop) => prop.type === "created_time");
  const updated = columns.some((prop) => prop.type === "updated_time");
  const entryHref: Record<string, string> = {};
  const chipHref: Record<string, string | null> = {};
  const rows = entries.map((entry, index): EntryRow => {
    entryHref[entry.id] = links.href(entry.id);
    const values = Object.fromEntries(Object.entries(entry.values).filter(([id]) => shown.has(id)));
    const cited = Object.fromEntries(Object.entries(entry.links ?? {}).filter(([id]) => shown.has(id)));
    for (const refs of Object.values(cited)) for (const ref of refs) chipHref[ref.id] = links.chip(ref);
    return {
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      values,
      // Le rang de la vue départage les tris du visiteur : sans tri, l'ordre
      // reste celui du serveur.
      manualOrder: String(index).padStart(6, "0"),
      createdAt: created ? entry.createdAt : NO_TIME,
      updatedAt: updated ? entry.updatedAt : NO_TIME,
      ...(shape.kind === "gallery" ? { cover: entry.cover ?? null, bodyImage: entry.bodyImage ?? null } : {}),
      ...(Object.keys(cited).length ? { links: cited } : {}),
      ...(entry.brokenRollups?.some((id) => shown.has(id)) ? { brokenRollups: entry.brokenRollups.filter((id) => shown.has(id)) } : {}),
    };
  });
  return { view: shape, columns, entries: rows, entryHref, chipHref, mediaBase: links.mediaBase };
}

// Ce que le visiteur peut filtrer : le titre, puis les colonnes affichées.
export function visitorFilterable(columns: readonly Property[]): Property[] {
  return [TITLE_PROP, ...columns.filter((prop) => filterOpsFor(prop).length > 0)];
}

export function visitorSortable(columns: readonly Property[]): { id: string; name: string }[] {
  return [{ id: TITLE_PROP.id, name: TITLE_PROP.name }, ...columns.map(({ id, name }) => ({ id, name }))];
}

// Ses filtres s'ajoutent les uns aux autres, après ceux de la vue (déjà
// appliqués par le serveur) ; son tri passe avant l'ordre de la vue.
export function applyVisitor(entries: readonly EntryRow[], columns: readonly Property[], state: VisitorState): EntryRow[] {
  const query = fold(state.query.trim());
  const kept = entries.filter(
    (entry) => (!query || fold(entry.title).includes(query)) && matchesFilters(entry, state.filters, columns),
  );
  return sortEntries(kept, state.sorts, columns);
}

// Choix d'un filtre de relation : les puces présentes dans les entrées, sans
// lire la base cible (sa route demande une session).
export function relationChoices(entries: readonly EntryRow[], prop: Property): { id: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const ref of entry.links?.[prop.id] ?? []) if (!ref.trashed && !seen.has(ref.id)) seen.set(ref.id, ref.title || "Sans titre");
  }
  return [...seen].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

// Choix d'un filtre de sélection : les options présentes, dans l'ordre du
// schéma, pour ne pas proposer une option qui ne trouverait rien.
export function presentOptions(entries: readonly EntryRow[], prop: Property): SelectOption[] {
  const used = new Set<string>();
  for (const entry of entries) {
    const value = entry.values[prop.id];
    for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string" && optionById(prop, id)) used.add(id);
  }
  return (prop.options ?? []).filter((option) => used.has(option.id));
}
