// Configuration d'une base : propriétés et vues. Plusieurs vues nommées
// (Tableau, Kanban, Liste), chacune avec ses filtres, tris, propriétés
// masquées et calculs ; schéma et entrées restent communs. Lecture tolérante
// de la configuration stockée, ancien format à vue unique compris, relu sans
// migration SQL. Module pur, serveur et navigateur. Formats : BRAINSTORMING §4.
import {
  formatNumber,
  ID_PATTERN,
  isGroupableType,
  isRecord,
  isSingleOptionType,
  isTimeType,
  LIMITS,
  localId,
  normalizeValue,
  optionById,
  sanitizeFilter,
  SORT_BUILTINS,
  TITLE_PROP,
  validateProperties,
  type EntryRow,
  type Filter,
  type Property,
  type Sort,
  type Values,
} from "./properties";
import { parseCover } from "./covers";
import { CALENDAR_SCALES, CALENDAR_SCALE_DEFAULT, type CalendarScale } from "./calendar";
import { MEDIA_BASE } from "./icons";
import { isStoredName } from "./upload_rules";

export const VIEW_KINDS = ["table", "board", "list", "gallery", "calendar"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export const VIEW_LABELS: Record<ViewKind, string> = {
  table: "Tableau",
  board: "Kanban",
  list: "Liste",
  gallery: "Galerie",
  calendar: "Calendrier",
};

// Galerie : taille des cartes, titre affiché ou non.
export const CARD_SIZES = ["small", "medium", "large"] as const;
export type CardSize = (typeof CARD_SIZES)[number];
export const CARD_SIZE_LABELS: Record<CardSize, string> = { small: "Petite", medium: "Moyenne", large: "Grande" };
export const CARD_SIZE_DEFAULT: CardSize = "medium";

export const CALC_OPS = ["count_all", "count_filled", "count_empty", "sum", "avg", "min", "max"] as const;
export type CalcOp = (typeof CALC_OPS)[number];
// Libellé du menu, puis libellé court affiché devant le résultat.
export const CALC_LABELS: Record<CalcOp, string> = {
  count_all: "Compter tout",
  count_filled: "Compter les remplis",
  count_empty: "Compter les vides",
  sum: "Somme",
  avg: "Moyenne",
  min: "Minimum",
  max: "Maximum",
};
const CALC_SHORT: Record<CalcOp, string> = {
  count_all: "Total",
  count_filled: "Remplis",
  count_empty: "Vides",
  sum: "Somme",
  avg: "Moyenne",
  min: "Min.",
  max: "Max.",
};
const NUMERIC_CALCS: ReadonlySet<CalcOp> = new Set(["sum", "avg", "min", "max"]);

// group_by : id d'une propriété discrète (Kanban). hidden : ids des
// propriétés absentes de la vue (colonnes, champs des cartes, valeurs de la
// liste et de la galerie), toujours modifiables dans l'entrée.
// hidden_columns : colonnes du Kanban masquées, par propriété de regroupement.
// calcs : calcul en pied de colonne, par propriété (« title » pour le titre).
// card_size, show_title, calendar_scale et date_prop ne servent qu'aux vues
// Galerie et Calendrier, mais sont relus pour toute vue : changer de type ne
// les perd pas.
export type View = {
  id: string;
  name: string;
  kind: ViewKind;
  group_by: string | null;
  filters: Filter[];
  sorts: Sort[];
  hidden: string[];
  hidden_columns: Record<string, string[]>;
  calcs: Record<string, CalcOp>;
  card_size: CardSize;
  show_title: boolean;
  calendar_scale: CalendarScale;
  date_prop: string | null;
};
export type DbConfig = { properties: Property[]; views: View[] };

export const VIEW_LIMITS = { views: 20, name: 100 };
// Id de la vue unique d'une configuration écrite avant l'étape 8 : fixe, pour
// qu'une adresse ?vue= ou un choix mémorisé survivent jusqu'à sa réécriture.
export const LEGACY_VIEW_ID = "view_main";

// Calculs proposés pour une colonne : les comptes partout, les calculs
// numériques sur un Nombre seulement.
export function calcOpsFor(prop: Property): CalcOp[] {
  return CALC_OPS.filter((op) => !NUMERIC_CALCS.has(op) || prop.type === "number");
}

// Lecture tolérante d'une vue : ce qui pointe vers une propriété disparue,
// une option supprimée, un opérateur ou un calcul devenus étrangers au type
// est retiré sans erreur. Un Kanban groupe par défaut sur la première
// Sélection, à défaut la première propriété discrète.
export function sanitizeView(raw: unknown, properties: readonly Property[], fallbackId = LEGACY_VIEW_ID): View {
  const view = isRecord(raw) ? raw : {};
  const kind: ViewKind = (VIEW_KINDS as readonly unknown[]).includes(view.kind) ? (view.kind as ViewKind) : "table";
  const id = typeof view.id === "string" && ID_PATTERN.test(view.id) ? view.id : fallbackId;
  const typedName = typeof view.name === "string" ? view.name.trim().slice(0, VIEW_LIMITS.name) : "";

  const groupables = properties.filter((prop) => isGroupableType(prop.type));
  const fallback = groupables.find((prop) => isSingleOptionType(prop.type)) ?? groupables[0];
  const groupBy = groupables.some((prop) => prop.id === view.group_by) ? (view.group_by as string) : (fallback?.id ?? null);

  const filters: Filter[] = [];
  for (const item of Array.isArray(view.filters) ? view.filters : []) {
    const filter = sanitizeFilter(item, properties);
    if (filter) filters.push(filter);
    if (filters.length === LIMITS.filters) break;
  }

  const sorts: Sort[] = [];
  for (const item of Array.isArray(view.sorts) ? view.sorts : []) {
    if (!isRecord(item) || typeof item.prop !== "string") continue;
    const known = item.prop in SORT_BUILTINS || properties.some((prop) => prop.id === item.prop);
    if (!known || sorts.some((sort) => sort.prop === item.prop)) continue;
    sorts.push({ prop: item.prop, dir: item.dir === "desc" ? "desc" : "asc" });
    if (sorts.length === LIMITS.sorts) break;
  }

  const hidden = (Array.isArray(view.hidden) ? view.hidden : []).filter(
    (item, index, all): item is string => typeof item === "string" && all.indexOf(item) === index && properties.some((prop) => prop.id === item),
  );

  const hiddenColumns: Record<string, string[]> = {};
  if (isRecord(view.hidden_columns)) {
    for (const [propId, keys] of Object.entries(view.hidden_columns)) {
      if (!properties.some((prop) => prop.id === propId) || !Array.isArray(keys)) continue;
      hiddenColumns[propId] = keys.filter((key, index, all): key is string => typeof key === "string" && all.indexOf(key) === index);
    }
  }

  const calcs: Record<string, CalcOp> = {};
  if (isRecord(view.calcs)) {
    for (const [propId, op] of Object.entries(view.calcs)) {
      const prop = propId === TITLE_PROP.id ? TITLE_PROP : properties.find((p) => p.id === propId);
      if (prop && calcOpsFor(prop).includes(op as CalcOp)) calcs[propId] = op as CalcOp;
    }
  }

  // Calendrier : la propriété Date choisie, à défaut la première de la base
  // (null s'il n'y en a pas, la vue invite alors à en créer une).
  const dateProps = properties.filter((prop) => prop.type === "date");
  const dateProp = dateProps.some((prop) => prop.id === view.date_prop) ? (view.date_prop as string) : (dateProps[0]?.id ?? null);

  return {
    id,
    name: typedName || VIEW_LABELS[kind],
    kind,
    group_by: groupBy,
    filters,
    sorts,
    hidden,
    hidden_columns: hiddenColumns,
    calcs,
    card_size: (CARD_SIZES as readonly unknown[]).includes(view.card_size) ? (view.card_size as CardSize) : CARD_SIZE_DEFAULT,
    show_title: typeof view.show_title === "boolean" ? view.show_title : true,
    calendar_scale: (CALENDAR_SCALES as readonly unknown[]).includes(view.calendar_scale)
      ? (view.calendar_scale as CalendarScale)
      : CALENDAR_SCALE_DEFAULT,
    date_prop: dateProp,
  };
}

// Liste de vues : ids en double écartés, au plus 20, jamais vide.
export function sanitizeViews(raw: unknown, properties: readonly Property[]): View[] {
  const views: View[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const view = sanitizeView(item, properties, "");
    if (!view.id || views.some((other) => other.id === view.id)) continue;
    views.push(view);
    if (views.length === VIEW_LIMITS.views) break;
  }
  return views.length > 0 ? views : [sanitizeView({}, properties)];
}

export function emptyConfig(): DbConfig {
  return { properties: [], views: [sanitizeView({}, [])] };
}

// Configurations écrites avant la suppression du type « Statut » : le type
// devient « Sélection » et les options reprennent l'ordre qu'elles avaient à
// l'écran (groupes à faire, en cours, terminé), avant que validateOptions ne
// reconstruise chaque option sans groupe. Une modification ultérieure de la
// base réécrit la configuration migrée.
const LEGACY_STATUS_GROUPS = ["todo", "in_progress", "complete"];

function legacyGroupRank(option: unknown): number {
  const group = isRecord(option) && typeof option.group === "string" ? option.group : "";
  const rank = LEGACY_STATUS_GROUPS.indexOf(group);
  return rank === -1 ? LEGACY_STATUS_GROUPS.length : rank;
}

function migrateLegacyProperties(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (!isRecord(item) || item.type !== "status") return item;
    const options = Array.isArray(item.options) ? [...item.options].sort((a, b) => legacyGroupRank(a) - legacyGroupRank(b)) : item.options;
    return { ...item, type: "select", options };
  });
}

// Lecture tolérante d'une configuration stockée (déjà validée à l'écriture).
// Avant l'étape 8, une base n'avait qu'une `view` : elle devient une liste
// d'une vue, nommée d'après son type.
export function parseConfig(raw: unknown): DbConfig {
  const config = isRecord(raw) ? raw : {};
  const checked = validateProperties(migrateLegacyProperties(config.properties ?? []));
  const properties = typeof checked === "string" ? [] : checked;
  const views = Array.isArray(config.views) ? sanitizeViews(config.views, properties) : [sanitizeView(config.view, properties)];
  return { properties, views };
}

// --- Gestes sur la liste des vues -----------------------------------------

// « Tableau », sinon « Tableau 2 », « Tableau 3 »…
function uniqueViewName(views: readonly View[], base: string): string {
  const taken = new Set(views.map((view) => view.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// Vue neuve, sans filtre, nommée d'après son type.
export function newView(
  views: readonly View[],
  kind: ViewKind,
  properties: readonly Property[],
  makeId: (prefix: string) => string = localId,
): View {
  return sanitizeView({ id: makeId("view"), name: uniqueViewName(views, VIEW_LABELS[kind]), kind }, properties);
}

// Copie de tous les réglages, nom suivi de « (copie) ».
export function duplicateView(views: readonly View[], view: View, makeId: (prefix: string) => string = localId): View {
  const name = uniqueViewName(views, `${view.name} (copie)`.slice(0, VIEW_LIMITS.name));
  return { ...structuredClone(view), id: makeId("view"), name };
}

// Vue à ouvrir : celle demandée (adresse, mémoire de l'appareil) si elle
// existe encore, sinon la première.
export function pickView(views: readonly View[], ...wanted: (string | null | undefined)[]): View {
  for (const id of wanted) {
    const found = id ? views.find((view) => view.id === id) : undefined;
    if (found) return found;
  }
  return views[0];
}

// Valeurs qu'une entrée créée depuis cette vue doit porter pour y rester
// visible : celles que ses filtres imposent sans ambiguïté (Sélection « est »,
// Sélection multiple « contient », case cochée). Le premier filtre l'emporte.
export function prefillValues(view: View, properties: readonly Property[]): Values {
  const values: Values = {};
  for (const filter of view.filters) {
    const prop = properties.find((p) => p.id === filter.prop);
    if (!prop || values[prop.id] !== undefined) continue;
    if (prop.type === "checkbox" && filter.op === "checked") values[prop.id] = true;
    if (!filter.value || !optionById(prop, filter.value)) continue;
    if (prop.type === "select" && filter.op === "is") values[prop.id] = filter.value;
    if (prop.type === "multiselect" && filter.op === "contains") values[prop.id] = [filter.value];
  }
  return values;
}

// --- Galerie --------------------------------------------------------------

// Image d'une carte : le bandeau de l'entrée, à défaut la première image de son
// corps (lue en SQL par listEntries), à défaut rien. Une adresse de corps n'est
// gardée que si elle est un média stocké ou une adresse web, même filtre que
// pour le rendu du corps (safeSrc de lib/blocks.ts).
export function cardImage(entry: Pick<EntryRow, "cover" | "bodyImage">): string | null {
  const cover = parseCover(entry.cover ?? null);
  if (cover?.kind === "image") return `${MEDIA_BASE}${cover.filename}`;
  const raw = entry.bodyImage;
  if (typeof raw !== "string") return null;
  const media = raw.match(/^\/api\/media\/([^/?#]+)$/);
  if (media) return isStoredName(media[1]) ? raw : null;
  return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : null;
}

// --- Calculs en pied de tableau ------------------------------------------

// Résultat d'un calcul sur les entrées montrées par la vue ; null pour un
// calcul numérique sans aucune valeur.
export function computeCalc(entries: readonly EntryRow[], prop: Property, op: CalcOp): number | null {
  const filled = (entry: EntryRow): boolean => {
    if (prop.id === TITLE_PROP.id) return entry.title.trim() !== "";
    if (isTimeType(prop.type)) return true;
    return normalizeValue(prop, entry.values[prop.id]) !== undefined;
  };
  switch (op) {
    case "count_all":
      return entries.length;
    case "count_filled":
      return entries.filter(filled).length;
    case "count_empty":
      return entries.filter((entry) => !filled(entry)).length;
  }
  const numbers = entries.flatMap((entry) => {
    const value = normalizeValue(prop, entry.values[prop.id]);
    return typeof value === "number" ? [value] : [];
  });
  if (numbers.length === 0) return null;
  switch (op) {
    case "sum":
      return numbers.reduce((total, n) => total + n, 0);
    case "avg":
      return numbers.reduce((total, n) => total + n, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
  }
}

// « Somme 1 234,5 € », « Total 12 », « Moyenne — » sans valeur.
export function calcText(prop: Property, op: CalcOp, result: number | null): string {
  if (result === null) return `${CALC_SHORT[op]} —`;
  if (!NUMERIC_CALCS.has(op)) return `${CALC_SHORT[op]} ${result}`;
  return `${CALC_SHORT[op]} ${formatNumber(result, prop.format, op === "avg" ? 2 : 10)}`;
}
