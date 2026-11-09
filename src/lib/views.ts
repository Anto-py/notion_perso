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
  rollupResultType,
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
// column_order : ordre des colonnes du Kanban propre à la vue, par propriété
// de regroupement (le schéma n'en est pas touché). collapsed_columns :
// colonnes repliées, titre visible et dépôt permis, cartes cachées.
// calcs : calcul en pied de colonne, par propriété (« title » pour le titre).
// card_size, show_title, calendar_scale et date_prop ne servent qu'aux vues
// Galerie et Calendrier, mais sont relus pour toute vue : changer de type ne
// les perd pas. frozen_first_column et frozen_header ne servent qu'au tableau
// (editable et public), relus de même pour survivre à un changement de type.
// column_widths : largeur en pixels d'une colonne, par propriété (« title »
// pour le titre), propre à la vue et jamais au schéma. Absente, la colonne
// reprend son calcul automatique.
export type View = {
  id: string;
  name: string;
  kind: ViewKind;
  group_by: string | null;
  filters: Filter[];
  sorts: Sort[];
  hidden: string[];
  hidden_columns: Record<string, string[]>;
  column_order: Record<string, string[]>;
  collapsed_columns: Record<string, string[]>;
  calcs: Record<string, CalcOp>;
  card_size: CardSize;
  show_title: boolean;
  calendar_scale: CalendarScale;
  date_prop: string | null;
  frozen_first_column: boolean;
  frozen_header: boolean;
  column_widths: Record<string, number>;
};
export type DbConfig = { properties: Property[]; views: View[] };

// Bornes d'une largeur de colonne : une valeur venue du navigateur ne peut ni
// écraser une colonne ni déborder sans fin.
export const COLUMN_WIDTH_LIMITS = { min: 60, max: 800 } as const;

export function clampColumnWidth(width: number): number {
  return Math.min(COLUMN_WIDTH_LIMITS.max, Math.max(COLUMN_WIDTH_LIMITS.min, Math.round(width)));
}

export const VIEW_LIMITS = { views: 20, name: 100 };
// Id de la vue unique d'une configuration écrite avant l'étape 8 : fixe, pour
// qu'une adresse ?vue= ou un choix mémorisé survivent jusqu'à sa réécriture.
export const LEGACY_VIEW_ID = "view_main";

// Calculs proposés pour une colonne : les comptes partout, les calculs
// numériques sur un Nombre et sur un cumul qui rend un nombre. Un cumul de
// date ne se somme pas, il ne garde que les comptes.
export function calcOpsFor(prop: Property): CalcOp[] {
  const numeric = prop.type === "number" || (prop.type === "rollup" && rollupResultType(prop.calc) === "number");
  return CALC_OPS.filter((op) => !NUMERIC_CALCS.has(op) || numeric);
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
    hidden_columns: columnKeys(view.hidden_columns, properties),
    column_order: columnKeys(view.column_order, properties),
    collapsed_columns: columnKeys(view.collapsed_columns, properties),
    calcs,
    card_size: (CARD_SIZES as readonly unknown[]).includes(view.card_size) ? (view.card_size as CardSize) : CARD_SIZE_DEFAULT,
    show_title: typeof view.show_title === "boolean" ? view.show_title : true,
    calendar_scale: (CALENDAR_SCALES as readonly unknown[]).includes(view.calendar_scale)
      ? (view.calendar_scale as CalendarScale)
      : CALENDAR_SCALE_DEFAULT,
    date_prop: dateProp,
    frozen_first_column: typeof view.frozen_first_column === "boolean" ? view.frozen_first_column : false,
    frozen_header: typeof view.frozen_header === "boolean" ? view.frozen_header : false,
    column_widths: readColumnWidths(view.column_widths, properties),
  };
}

// Clés de colonnes Kanban par propriété de regroupement : propriété disparue
// écartée, doublons et valeurs non textuelles retirés. Une clé d'option
// supprimée peut rester, elle ne désigne plus aucune colonne et reste muette.
function columnKeys(raw: unknown, properties: readonly Property[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!isRecord(raw)) return result;
  for (const [propId, keys] of Object.entries(raw)) {
    if (!properties.some((prop) => prop.id === propId) || !Array.isArray(keys)) continue;
    result[propId] = keys.filter((key, index, all): key is string => typeof key === "string" && all.indexOf(key) === index);
  }
  return result;
}

// Largeurs de colonnes : propriété disparue, valeur non numérique ou non finie
// écartée ; la largeur est ramenée dans les bornes et arrondie. « title »
// désigne la colonne du titre, qui n'est pas dans les propriétés.
function readColumnWidths(raw: unknown, properties: readonly Property[]): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(raw)) return result;
  const known = new Set([TITLE_PROP.id, ...properties.map((prop) => prop.id)]);
  for (const [propId, value] of Object.entries(raw)) {
    if (!known.has(propId) || typeof value !== "number" || !Number.isFinite(value)) continue;
    result[propId] = clampColumnWidth(value);
  }
  return result;
}

// Largeur d'une colonne : null rend la colonne à son calcul automatique.
export function withColumnWidth(view: View, propId: string, width: number | null): View {
  const column_widths = { ...view.column_widths };
  if (width === null) delete column_widths[propId];
  else column_widths[propId] = clampColumnWidth(width);
  return { ...view, column_widths };
}

// Réglage des colonnes du Kanban pour une propriété de regroupement : ordre,
// colonnes masquées ou repliées. Les autres propriétés gardent les leurs.
export type BoardColumnsPatch = { order?: string[]; hidden?: string[]; collapsed?: string[] };

export function withBoardColumns(view: View, propId: string, patch: BoardColumnsPatch): View {
  const set = (current: Record<string, string[]>, keys: string[] | undefined) => (keys ? { ...current, [propId]: keys } : current);
  return {
    ...view,
    column_order: set(view.column_order, patch.order),
    hidden_columns: set(view.hidden_columns, patch.hidden),
    collapsed_columns: set(view.collapsed_columns, patch.collapsed),
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

// --- Vue liée -------------------------------------------------------------
//
// Un bloc « linked » montre une base existante. Ses vues sont celles de la
// base : les onglets, leurs noms et leur ordre viennent d'elle, et le bloc ne
// garde que des surcharges locales, par vue. Une surcharge posée dans le bloc
// l'emporte pour ce bloc ; « Revenir à la base » l'efface. Une configuration
// écrite avant l'héritage (liste `views` copiée) est ignorée : le bloc repart
// de la base.

// Champs qu'une vue liée peut surcharger. L'identifiant, le nom et le type
// restent ceux de la base : les onglets du bloc sont ceux de la base.
export type ViewOverride = Partial<Omit<View, "id" | "name" | "kind">>;
export type LinkedConfig = { active: string | null; overrides: Record<string, ViewOverride> };

function configRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

// Lecture tolérante : texte vide, illisible ou ancien format donnent un bloc
// qui suit la base, sans surcharge.
export function parseLinkedConfig(raw: unknown): LinkedConfig {
  const record = configRecord(raw);
  const overrides: Record<string, ViewOverride> = {};
  if (isRecord(record?.overrides)) {
    for (const [viewId, patch] of Object.entries(record.overrides)) {
      if (isRecord(patch)) overrides[viewId] = patch as ViewOverride;
    }
  }
  return { active: typeof record?.active === "string" ? record.active : null, overrides };
}

// Texte rangé dans la propriété du bloc.
export function linkedConfigText(config: LinkedConfig): string {
  return JSON.stringify(config);
}

// Vues montrées par le bloc : celles de la base, chacune avec sa surcharge
// locale relue contre les propriétés du moment. Une surcharge qui vise une vue
// disparue ne sert plus. Le nom et l'identifiant restent ceux de la base.
export function linkedViews(baseViews: readonly View[], config: LinkedConfig, properties: readonly Property[]): View[] {
  return baseViews.map((base) => {
    const patch = config.overrides[base.id];
    if (!patch) return base;
    return sanitizeView({ ...base, ...patch, id: base.id, name: base.name, kind: base.kind }, properties, base.id);
  });
}

// Champs par lesquels une vue réglée dans le bloc s'écarte de celle de la base.
// Vide, la vue suit la base : la surcharge est alors retirée.
export function viewOverride(base: View, next: View): ViewOverride {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    if (key === "id" || key === "name" || key === "kind") continue;
    const value = (next as Record<string, unknown>)[key];
    if (JSON.stringify(value) !== JSON.stringify((base as Record<string, unknown>)[key])) patch[key] = value;
  }
  return patch as ViewOverride;
}

export function withoutLinkedOverride(config: LinkedConfig, viewId: string): LinkedConfig {
  const overrides = { ...config.overrides };
  delete overrides[viewId];
  return { ...config, overrides };
}

export function withLinkedOverride(config: LinkedConfig, viewId: string, patch: ViewOverride): LinkedConfig {
  if (Object.keys(patch).length === 0) return withoutLinkedOverride(config, viewId);
  return { ...config, overrides: { ...config.overrides, [viewId]: patch } };
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
