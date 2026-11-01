// Propriétés des bases, les vues : lecture tolérante d'un filtre, filtre,
// tri, colonnes Kanban, ordre manuel après un dépôt.
import { compareKeys } from "./order_key";
import { brusselsParts, isIsoDate, parseNumber } from "./property_format";
import {
  LIMITS,
  OPS_BY_TYPE,
  TITLE_PROP,
  fold,
  isOptionType,
  isRecord,
  isTimeType,
  opNeedsValue,
  optionById,
  type EntryRow,
  type Filter,
  type FilterOp,
  type OptionColor,
  type Property,
  type Sort,
  type Value,
} from "./property_schema";
import { normalizeValue, valueText } from "./property_values";

// Lecture tolérante d'un filtre : ce qui pointe vers une propriété disparue,
// une option supprimée ou un opérateur devenu étranger au type est retiré.
export function sanitizeFilter(raw: unknown, properties: readonly Property[]): Filter | null {
  if (!isRecord(raw) || typeof raw.prop !== "string" || typeof raw.op !== "string") return null;
  const prop = raw.prop === TITLE_PROP.id ? TITLE_PROP : properties.find((p) => p.id === raw.prop);
  if (!prop || !OPS_BY_TYPE[prop.type].includes(raw.op as FilterOp)) return null;
  const op = raw.op as FilterOp;
  if (!opNeedsValue(op)) return { prop: prop.id, op };
  const value = typeof raw.value === "string" ? raw.value.slice(0, LIMITS.name) : "";
  // Un filtre sans valeur reste affiché, inactif ; une valeur devenue
  // invalide (option supprimée, date illisible) le retire.
  if (value === "") return { prop: prop.id, op, value };
  if (isOptionType(prop.type)) {
    if (!optionById(prop, value)) return null;
  } else if ((prop.type === "date" || isTimeType(prop.type)) && !isIsoDate(value)) {
    return null;
  } else if (prop.type === "number" && parseNumber(value) === null) {
    // Saisie en cours (« 1, ») : le filtre reste, inactif.
    return { prop: prop.id, op, value: "" };
  }
  return { prop: prop.id, op, value };
}

function filterProp(id: string, properties: readonly Property[]): Property | undefined {
  return id === TITLE_PROP.id ? TITLE_PROP : properties.find((prop) => prop.id === id);
}

function matchesFilter(entry: EntryRow, filter: Filter, properties: readonly Property[]): boolean {
  const prop = filterProp(filter.prop, properties);
  if (!prop) return true;
  const value =
    prop === TITLE_PROP
      ? normalizeValue(prop, entry.title)
      : isTimeType(prop.type)
        ? prop.type === "created_time"
          ? entry.createdAt
          : entry.updatedAt
        : normalizeValue(prop, entry.values[prop.id]);
  switch (filter.op) {
    case "is_empty":
      return value === undefined;
    case "is_not_empty":
      return value !== undefined;
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
  }
  const target = filter.value ?? "";
  if (target === "") return true;
  if (prop.type === "number") {
    const wanted = parseNumber(target);
    if (wanted === null) return true;
    // « ≠ » garde les entrées vides, comme « n'est pas » d'une sélection.
    if (typeof value !== "number") return filter.op === "neq";
    switch (filter.op) {
      case "eq":
        return value === wanted;
      case "neq":
        return value !== wanted;
      case "gt":
        return value > wanted;
      case "lt":
        return value < wanted;
    }
  }
  if (isTimeType(prop.type)) {
    const day = typeof value === "string" ? brusselsParts(value)?.day : undefined;
    if (!day) return false;
    if (filter.op === "is") return day === target;
    if (filter.op === "before") return day < target;
    if (filter.op === "after") return day > target;
  }
  switch (filter.op) {
    case "contains":
      return prop.type === "multiselect" || prop.type === "relation"
        ? Array.isArray(value) && value.includes(target)
        : fold(valueText(prop, value)).includes(fold(target));
    case "not_contains":
      return !(Array.isArray(value) && value.includes(target));
    case "is":
      return value === target;
    case "is_not":
      return value !== target;
    case "before":
      return typeof value === "string" && value < target;
    case "after":
      return typeof value === "string" && value > target;
    default:
      return true;
  }
}

// Filtres combinés par « et ».
export function matchesFilters(entry: EntryRow, filters: readonly Filter[], properties: readonly Property[]): boolean {
  return filters.every((filter) => matchesFilter(entry, filter, properties));
}

type SortKey = (entry: EntryRow) => string | number | undefined;

function sortKey(propId: string, properties: readonly Property[]): SortKey | null {
  if (propId === "title") return (entry) => entry.title || undefined;
  if (propId === "created_at") return (entry) => Date.parse(entry.createdAt);
  if (propId === "updated_at") return (entry) => Date.parse(entry.updatedAt);
  const prop = properties.find((p) => p.id === propId);
  if (!prop) return null;
  switch (prop.type) {
    case "checkbox":
      return (entry) => (entry.values[prop.id] === true ? 1 : 0);
    case "number":
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        return typeof value === "number" ? value : undefined;
      };
    case "created_time":
    case "updated_time":
      return (entry) => Date.parse(prop.type === "created_time" ? entry.createdAt : entry.updatedAt);
    case "date":
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        return typeof value === "string" ? Date.parse(value) : undefined;
      };
    // Le titre de la première puce, lu à la lecture (entry.links).
    case "relation":
      return (entry) => entry.links?.[prop.id]?.[0]?.title || undefined;
    // Une sélection se trie dans l'ordre de ses options, pas par ordre
    // alphabétique : c'est aussi l'ordre des colonnes du Kanban.
    case "select":
    case "multiselect":
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        if (value === undefined) return undefined;
        const ids = Array.isArray(value) ? value : [value as string];
        const order = prop.options ?? [];
        return Math.min(...ids.map((id) => order.findIndex((option) => option.id === id)));
      };
    default:
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        return typeof value === "string" ? value : undefined;
      };
  }
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// Tri à plusieurs clés. Les valeurs vides vont en dernier quel que soit le
// sens ; à égalité, l'ordre manuel puis l'ancienneté départagent.
export function sortEntries(entries: readonly EntryRow[], sorts: readonly Sort[], properties: readonly Property[]): EntryRow[] {
  const keys = sorts.flatMap((sort) => {
    const key = sortKey(sort.prop, properties);
    return key ? [{ key, dir: sort.dir === "desc" ? -1 : 1 }] : [];
  });
  return [...entries].sort((a, b) => {
    for (const { key, dir } of keys) {
      const ka = key(a);
      const kb = key(b);
      if (ka === undefined || kb === undefined) {
        if (ka === kb) continue;
        return ka === undefined ? 1 : -1;
      }
      const order = typeof ka === "number" && typeof kb === "number" ? ka - kb : collator.compare(String(ka), String(kb));
      if (order !== 0) return order * dir;
    }
    return compareKeys(a.manualOrder, b.manualOrder) || Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

// value : ce qu'un dépôt dans cette colonne écrit dans l'entrée (id d'option,
// liste d'ids, true), null pour la colonne « Sans … » et « Non coché ».
export type Column = { key: string | null; name: string; color: OptionColor | null; value: Value | null; entries: EntryRow[] };

// Clé de la colonne « Sans … » quand on la range dans hidden_columns, dont
// les clés sont des chaînes (null n'en est pas une).
export const NO_COLUMN = "__none__";

// « Statut » → « Sans statut » ; un sigle (« TVA ») garde sa casse.
function withoutLabel(name: string): string {
  const lower = name.length > 1 && name[1] === name[1].toLowerCase() ? name[0].toLowerCase() + name.slice(1) : name;
  return `Sans ${lower}`;
}

// Ordre canonique des ids d'une multi-sélection : celui des options, pour que
// deux entrées qui portent les mêmes valeurs tombent dans la même colonne.
function canonicalIds(prop: Property, ids: readonly string[]): string[] {
  const order = new Map((prop.options ?? []).map((option, index) => [option.id, index]));
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

// Colonnes Kanban selon la propriété de regroupement.
// - Sélection : « Sans … » puis une colonne par option, même vide.
// - Sélection multiple : « Sans … » puis une colonne par combinaison de
//   valeurs présente, rangée par nom.
// - Case à cocher : « Non coché » puis « Coché ».
// Les entrées gardent l'ordre reçu.
export function groupEntries(entries: readonly EntryRow[], prop: Property): Column[] {
  const columns: Column[] = [];
  const byKey = new Map<string | null, Column>();
  const add = (key: string | null, name: string, color: OptionColor | null, value: Value | null): Column => {
    const column = { key, name, color, value, entries: [] as EntryRow[] };
    columns.push(column);
    byKey.set(key, column);
    return column;
  };

  if (prop.type === "checkbox") {
    add("false", "Non coché", null, null);
    add("true", "Coché", null, true);
  } else {
    add(null, withoutLabel(prop.name), null, null);
    if (prop.type === "select") {
      for (const option of prop.options ?? []) add(option.id, option.name, option.color, option.id);
    }
  }

  for (const entry of entries) {
    const value = normalizeValue(prop, entry.values[prop.id]);
    let column: Column | undefined;
    if (prop.type === "checkbox") {
      column = byKey.get(value === true ? "true" : "false");
    } else if (prop.type === "multiselect") {
      const ids = Array.isArray(value) ? canonicalIds(prop, value) : [];
      if (ids.length === 0) {
        column = byKey.get(null);
      } else {
        const key = ids.join(",");
        column =
          byKey.get(key) ??
          add(key, ids.map((id) => optionById(prop, id)?.name ?? "").join(", "), null, ids);
      }
    } else {
      column = byKey.get(typeof value === "string" ? value : null) ?? byKey.get(null);
    }
    column?.entries.push(entry);
  }

  // Les combinaisons d'une multi-sélection ne viennent pas du schéma : on les
  // range par nom, après « Sans … », pour que leur ordre ne dépende pas de
  // l'ordre d'arrivée des entrées.
  if (prop.type === "multiselect") {
    const [first, ...rest] = columns;
    rest.sort((a, b) => collator.compare(a.name, b.name));
    return [first, ...rest];
  }
  return columns;
}

// Ordre manuel complet après un dépôt Kanban. allIds est l'ordre de toutes les
// entrées de la base (masquées par les filtres comprises), les colonnes n'en
// montrent qu'une partie : les cartes visibles servent de repères, les autres
// gardent leur rang. « end » range la carte en fin de colonne : après sa
// dernière carte visible, sinon avant la première de la colonne suivante qui
// en a une, sinon après la dernière de la précédente.
export function boardOrder(
  allIds: readonly string[],
  columns: readonly Column[],
  movedId: string,
  targetKey: string | null,
  place: { before: string } | { after: string } | { end: true },
): string[] {
  if (!allIds.includes(movedId)) return [...allIds];
  const rest = allIds.filter((id) => id !== movedId);

  if (!("end" in place)) {
    const anchor = "before" in place ? place.before : place.after;
    if (anchor === movedId) return [...allIds];
    const index = rest.indexOf(anchor);
    if (index === -1) return [...allIds];
    rest.splice("before" in place ? index : index + 1, 0, movedId);
    return rest;
  }

  const target = columns.findIndex((column) => column.key === targetKey);
  if (target === -1) return [...allIds];
  const others = <T extends EntryRow>(list: readonly T[]) => list.filter((entry) => entry.id !== movedId);

  let anchor: string | undefined = others(columns[target].entries).at(-1)?.id;
  let insertAfter = true;
  if (!anchor) {
    for (let i = target + 1; i < columns.length && !anchor; i++) {
      const next = others(columns[i].entries)[0];
      if (next) {
        anchor = next.id;
        insertAfter = false;
      }
    }
  }
  for (let i = target - 1; i >= 0 && !anchor; i--) {
    anchor = others(columns[i].entries).at(-1)?.id;
  }
  if (!anchor) {
    rest.push(movedId);
    return rest;
  }
  const index = rest.indexOf(anchor);
  if (index === -1) return [...allIds];
  rest.splice(insertAfter ? index + 1 : index, 0, movedId);
  return rest;
}

// Ordre manuel après avoir déposé movedId avant ou après une autre entrée.
// Ancre absente, ou l'entrée elle-même : l'ordre ne change pas.
export function moveInOrder(ids: readonly string[], movedId: string, place: { before: string } | { after: string }): string[] {
  const anchor = "before" in place ? place.before : place.after;
  const rest = ids.filter((id) => id !== movedId);
  const index = rest.indexOf(anchor);
  if (anchor === movedId || index === -1 || !ids.includes(movedId)) return [...ids];
  rest.splice("before" in place ? index : index + 1, 0, movedId);
  return rest;
}
