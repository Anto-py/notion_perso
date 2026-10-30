// Propriétés des bases : types, configuration, valeurs, filtre, tri,
// regroupement Kanban. Module pur, importé par le serveur (validation,
// migration des valeurs) comme par le navigateur (affichage, filtre, tri,
// confirmation avant une perte de valeurs). Formats jsonb : BRAINSTORMING §3-4.

export const PROPERTY_TYPES = ["text", "url", "date", "status", "select", "multiselect", "checkbox"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const TYPE_LABELS: Record<PropertyType, string> = {
  text: "Texte",
  url: "Lien",
  date: "Date",
  status: "Statut",
  select: "Sélection",
  multiselect: "Sélection multiple",
  checkbox: "Case à cocher",
};

// Une propriété « Statut » est une sélection dont les options sont rangées
// dans trois groupes fixes, dans cet ordre : c'est ce qui la distingue d'une
// simple sélection et ce qui donne son sens au Kanban (colonnes par groupe).
export const STATUS_GROUPS = ["todo", "in_progress", "complete"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  todo: "À faire",
  in_progress: "En cours",
  complete: "Terminé",
};

// Les types qui portent une liste d'options.
export function isOptionType(type: PropertyType): boolean {
  return type === "select" || type === "multiselect" || type === "status";
}

// Types à valeur unique choisie dans une liste d'options : ceux qui peuvent
// servir de colonnes Kanban.
export function isSingleOptionType(type: PropertyType): boolean {
  return type === "select" || type === "status";
}

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const COLOR_LABELS: Record<OptionColor, string> = {
  gray: "Gris",
  brown: "Brun",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
  red: "Rouge",
};

// group : présent uniquement sur les options d'une propriété « Statut ».
export type SelectOption = { id: string; name: string; color: OptionColor; group?: StatusGroup };
export type Property = { id: string; name: string; type: PropertyType; options?: SelectOption[] };

// text, url, date (AAAA-MM-JJ), select (id d'option) : chaîne ;
// multiselect : liste d'ids ; checkbox : true. Une valeur vide est absente.
export type Value = string | string[] | boolean;
export type Values = Record<string, Value>;

export const FILTER_OPS = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "before",
  "after",
  "is_empty",
  "is_not_empty",
  "checked",
  "unchecked",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const OPS_BY_TYPE: Record<PropertyType, FilterOp[]> = {
  text: ["contains", "is_empty", "is_not_empty"],
  url: ["contains", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "is_empty", "is_not_empty"],
  status: ["is", "is_not", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  multiselect: ["contains", "not_contains", "is_empty", "is_not_empty"],
  checkbox: ["checked", "unchecked"],
};

export const OP_LABELS: Record<FilterOp, string> = {
  contains: "contient",
  not_contains: "ne contient pas",
  is: "est",
  is_not: "n'est pas",
  before: "avant le",
  after: "après le",
  is_empty: "est vide",
  is_not_empty: "n'est pas vide",
  checked: "cochée",
  unchecked: "non cochée",
};

const OPS_WITHOUT_VALUE: ReadonlySet<FilterOp> = new Set(["is_empty", "is_not_empty", "checked", "unchecked"]);

export function opNeedsValue(op: FilterOp): boolean {
  return !OPS_WITHOUT_VALUE.has(op);
}

export type Filter = { prop: string; op: FilterOp; value?: string };
export type Sort = { prop: string; dir: "asc" | "desc" };
// group_by : id d'une propriété select (vue Kanban). Une seule vue par base.
export type View = { kind: "table" | "board"; group_by: string | null; filters: Filter[]; sorts: Sort[] };
export type DbConfig = { properties: Property[]; view: View };

// Une entrée telle que la lisent les vues (dates en ISO).
export type EntryRow = {
  id: string;
  title: string;
  icon: string | null;
  values: Values;
  manualOrder: number;
  createdAt: string;
  updatedAt: string;
};

// Le titre de l'entrée est le titre de sa page : une colonne fixe, filtrable
// et triable comme une propriété texte, mais jamais rangée parmi elles.
export const TITLE_PROP: Property = { id: "title", name: "Titre", type: "text" };

export const SORT_BUILTINS: Record<string, string> = {
  title: "Titre",
  created_at: "Date de création",
  updated_at: "Dernière modification",
};

export const LIMITS = { properties: 50, options: 200, name: 100, text: 5000, url: 2048, filters: 20, sorts: 5 };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUTHY = new Set(["oui", "vrai", "true", "yes", "x", "1"]);
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Comparaison insensible à la casse et aux accents (« Évaluation » = « evaluation »).
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Identifiant de propriété ou d'option, créé dans le navigateur : il n'a rien
// de secret, il doit seulement être unique dans sa base. 256 étant multiple
// de 64, le modulo ne biaise pas le tirage.
export function localId(prefix: string): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => ID_ALPHABET[byte % 64]).join("")}`;
}

export function emptyConfig(): DbConfig {
  return { properties: [], view: { kind: "table", group_by: null, filters: [], sorts: [] } };
}

export function optionById(prop: Property, id: string): SelectOption | undefined {
  return prop.options?.find((option) => option.id === id);
}

// Options dans l'ordre où on les lit : pour un statut, groupées (à faire,
// en cours, terminé), l'ordre interne à chaque groupe étant conservé.
export function orderedOptions(prop: Property): SelectOption[] {
  const options = prop.options ?? [];
  if (prop.type !== "status") return options;
  return [...options].sort(
    (a, b) => STATUS_GROUPS.indexOf(a.group ?? "todo") - STATUS_GROUPS.indexOf(b.group ?? "todo"),
  );
}

function optionByName(prop: Property, name: string): SelectOption | undefined {
  const wanted = fold(name.trim());
  return prop.options?.find((option) => fold(option.name) === wanted);
}

// La couleur la moins employée, la première de la palette à égalité.
export function nextColor(options: readonly SelectOption[]): OptionColor {
  const uses = new Map<OptionColor, number>(OPTION_COLORS.map((color) => [color, 0]));
  for (const option of options) uses.set(option.color, (uses.get(option.color) ?? 0) + 1);
  return OPTION_COLORS.reduce((best, color) => ((uses.get(color) ?? 0) < (uses.get(best) ?? 0) ? color : best));
}

// « Statut », sinon « Statut 2 », « Statut 3 »… : deux propriétés ne portent
// jamais le même nom, ni celui de la colonne Titre.
export function uniqueName(properties: readonly Property[], base: string): string {
  const taken = new Set([fold(TITLE_PROP.name), ...properties.map((prop) => fold(prop.name))]);
  if (!taken.has(fold(base))) return base;
  let n = 2;
  while (taken.has(fold(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

// --- Configuration ---------------------------------------------------------

// Validation stricte d'une liste de propriétés envoyée par le navigateur.
// Renvoie la liste nettoyée, ou un message d'erreur lisible.
export function validateProperties(raw: unknown): Property[] | string {
  if (!Array.isArray(raw)) return "Liste de propriétés attendue";
  if (raw.length > LIMITS.properties) return `Au plus ${LIMITS.properties} propriétés par base`;
  const ids = new Set<string>();
  const names = new Set<string>([fold(TITLE_PROP.name)]);
  const properties: Property[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return "Propriété invalide";
    const { id, type } = item;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (typeof id !== "string" || !ID_PATTERN.test(id) || id in SORT_BUILTINS || ids.has(id)) {
      return "Identifiant de propriété invalide ou en double";
    }
    if (!name || name.length > LIMITS.name) return "Chaque propriété porte un nom de 1 à 100 caractères";
    if (names.has(fold(name))) return `Le nom « ${name} » est déjà pris`;
    if (typeof type !== "string" || !(PROPERTY_TYPES as readonly string[]).includes(type)) return "Type de propriété inconnu";
    ids.add(id);
    names.add(fold(name));
    const prop: Property = { id, name, type: type as PropertyType };
    if (isOptionType(prop.type)) {
      const options = validateOptions(item.options ?? [], prop.type);
      if (typeof options === "string") return `${name} : ${options}`;
      prop.options = options;
    }
    properties.push(prop);
  }
  return properties;
}

function validateOptions(raw: unknown, type: PropertyType): SelectOption[] | string {
  if (!Array.isArray(raw)) return "liste d'options attendue";
  if (raw.length > LIMITS.options) return `au plus ${LIMITS.options} options`;
  const ids = new Set<string>();
  const names = new Set<string>();
  const options: SelectOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return "option invalide";
    const { id, color } = item;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (typeof id !== "string" || !ID_PATTERN.test(id) || ids.has(id)) return "identifiant d'option invalide ou en double";
    if (!name || name.length > LIMITS.name) return "chaque option porte un nom de 1 à 100 caractères";
    if (names.has(fold(name))) return `l'option « ${name} » existe déjà`;
    if (typeof color !== "string" || !(OPTION_COLORS as readonly string[]).includes(color)) return "couleur d'option inconnue";
    ids.add(id);
    names.add(fold(name));
    const option: SelectOption = { id, name, color: color as OptionColor };
    // Un statut range chaque option dans un groupe ; une sélection n'en a pas.
    if (type === "status") {
      const group = item.group ?? "todo";
      if (typeof group !== "string" || !(STATUS_GROUPS as readonly string[]).includes(group)) return "groupe d'option inconnu";
      option.group = group as StatusGroup;
    }
    options.push(option);
  }
  return options;
}

// Lecture tolérante de la vue : ce qui pointe vers une propriété disparue,
// une option supprimée ou un opérateur devenu étranger au type est retiré
// sans erreur. Une vue Kanban groupe par défaut sur la première sélection.
export function sanitizeView(raw: unknown, properties: readonly Property[]): View {
  const view = isRecord(raw) ? raw : {};
  const groupables = properties.filter((prop) => isSingleOptionType(prop.type));
  const groupBy = groupables.some((prop) => prop.id === view.group_by) ? (view.group_by as string) : (groupables[0]?.id ?? null);

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

  return { kind: view.kind === "board" ? "board" : "table", group_by: groupBy, filters, sorts };
}

function sanitizeFilter(raw: unknown, properties: readonly Property[]): Filter | null {
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
  } else if (prop.type === "date" && !isIsoDate(value)) {
    return null;
  }
  return { prop: prop.id, op, value };
}

// Lecture tolérante d'une configuration stockée (déjà validée à l'écriture).
export function parseConfig(raw: unknown): DbConfig {
  const config = isRecord(raw) ? raw : {};
  const checked = validateProperties(config.properties ?? []);
  const properties = typeof checked === "string" ? [] : checked;
  return { properties, view: sanitizeView(config.view, properties) };
}

// --- Valeurs ---------------------------------------------------------------

// Valeur lisible pour cette propriété, ou undefined si elle est vide ou
// invalide (option supprimée, date illisible).
export function normalizeValue(prop: Property, raw: unknown): Value | undefined {
  switch (prop.type) {
    case "text":
    case "url":
      return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
    case "date":
      return typeof raw === "string" && isIsoDate(raw) ? raw : undefined;
    case "status":
    case "select":
      return typeof raw === "string" && optionById(prop, raw) ? raw : undefined;
    case "multiselect": {
      if (!Array.isArray(raw)) return undefined;
      const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && !!optionById(prop, id)))];
      return ids.length > 0 ? ids : undefined;
    }
    case "checkbox":
      return raw === true ? true : undefined;
  }
}

// Les valeurs d'une entrée, réduites aux propriétés de la base.
export function normalizeValues(properties: readonly Property[], raw: unknown): Values {
  const source = isRecord(raw) ? raw : {};
  const values: Values = {};
  for (const prop of properties) {
    const value = normalizeValue(prop, source[prop.id]);
    if (value !== undefined) values[prop.id] = value;
  }
  return values;
}

// Contrôle d'une valeur envoyée par le navigateur. null efface toujours.
// Renvoie un message d'erreur, ou null si la valeur est recevable.
export function checkValue(prop: Property, raw: unknown): string | null {
  if (raw === null) return null;
  switch (prop.type) {
    case "text":
      return typeof raw === "string" && raw.length <= LIMITS.text ? null : `${prop.name} : texte de ${LIMITS.text} caractères au plus`;
    case "url":
      return typeof raw === "string" && raw.length <= LIMITS.url ? null : `${prop.name} : lien trop long`;
    case "date":
      return raw === "" || (typeof raw === "string" && isIsoDate(raw)) ? null : `${prop.name} : date invalide`;
    case "status":
    case "select":
      return raw === "" || (typeof raw === "string" && optionById(prop, raw)) ? null : `${prop.name} : option inconnue, rechargez la page`;
    case "multiselect":
      return Array.isArray(raw) && raw.every((id) => typeof id === "string" && optionById(prop, id))
        ? null
        : `${prop.name} : option inconnue, rechargez la page`;
    case "checkbox":
      return typeof raw === "boolean" ? null : `${prop.name} : vrai ou faux attendu`;
  }
}

// Forme texte canonique d'une valeur : recherche (values_text), conversion
// de type, filtre « contient ». Une date reste en AAAA-MM-JJ.
export function valueText(prop: Property, value: unknown): string {
  const normalized = normalizeValue(prop, value);
  if (normalized === undefined) return "";
  switch (prop.type) {
    case "checkbox":
      return "Oui";
    case "status":
    case "select":
      return optionById(prop, normalized as string)?.name ?? "";
    case "multiselect":
      return (normalized as string[]).map((id) => optionById(prop, id)?.name ?? "").join(", ");
    default:
      return normalized as string;
  }
}

// Texte aplati de toutes les valeurs d'une entrée : colonne values_text.
export function valuesToText(properties: readonly Property[], values: Values): string {
  return properties
    .map((prop) => valueText(prop, values[prop.id]))
    .filter((text) => text !== "")
    .join(" ");
}

function splitNames(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

// Option de `to` correspondant à l'option `id` de `from` : même id d'abord
// (select ↔ multiselect gardent leurs options), même nom sinon.
function mapOption(from: Property, to: Property, id: string): string | undefined {
  if (optionById(to, id)) return id;
  const name = optionById(from, id)?.name;
  return name ? optionByName(to, name)?.id : undefined;
}

// Conversion au mieux d'une valeur quand sa propriété change (type, options).
// undefined : la valeur ne survit pas.
export function convertValue(from: Property, to: Property, value: unknown): Value | undefined {
  if (from.type === to.type) return normalizeValue(to, value);
  const current = normalizeValue(from, value);
  if (current === undefined) return undefined;
  // Une valeur unique choisie (sélection ou statut) garde son option par id,
  // sinon par nom : le passage d'un type à l'autre ne perd rien.
  if (isSingleOptionType(from.type) && isSingleOptionType(to.type)) {
    return normalizeValue(to, mapOption(from, to, current as string));
  }
  if (isSingleOptionType(from.type) && to.type === "multiselect") {
    return normalizeValue(to, [mapOption(from, to, current as string)]);
  }
  if (from.type === "multiselect" && isSingleOptionType(to.type)) {
    return (current as string[]).map((id) => mapOption(from, to, id)).find((id) => id !== undefined);
  }
  const text = valueText(from, current).trim();
  switch (to.type) {
    case "text":
    case "url":
      return text || undefined;
    case "date":
      return isIsoDate(text) ? text : undefined;
    case "checkbox":
      return TRUTHY.has(fold(text)) ? true : undefined;
    case "status":
    case "select":
      return optionByName(to, text)?.id;
    case "multiselect":
      return normalizeValue(
        to,
        splitNames(text).map((name) => optionByName(to, name)?.id),
      );
  }
}

// Valeurs d'une entrée après un changement de la liste des propriétés : les
// propriétés retirées emportent leurs valeurs, les autres sont converties.
export function migrateValues(before: readonly Property[], after: readonly Property[], values: Values): Values {
  const migrated: Values = {};
  for (const prop of after) {
    const previous = before.find((p) => p.id === prop.id);
    if (!previous || values[prop.id] === undefined) continue;
    const value = convertValue(previous, prop, values[prop.id]);
    if (value !== undefined) migrated[prop.id] = value;
  }
  return migrated;
}

// La valeur perd-elle quelque chose ? Vidée, amputée d'une option, ou
// réécrite autrement par la conversion. Renommer une option n'est pas une
// perte : l'id reste.
function isLost(before: Property, after: Property | undefined, value: unknown): boolean {
  const current = normalizeValue(before, value);
  if (current === undefined) return false;
  if (!after) return true;
  const next = convertValue(before, after, current);
  if (next === undefined) return true;
  if (before.type === after.type) {
    return before.type === "multiselect" && (next as string[]).length < (current as string[]).length;
  }
  if (after.type === "checkbox") return false;
  return fold(valueText(after, next)) !== fold(valueText(before, current));
}

// Nombre d'entrées qui perdraient une valeur : la confirmation demandée
// avant de supprimer une option ou une propriété, ou de changer un type.
export function countLosses(before: readonly Property[], after: readonly Property[], valuesList: readonly Values[]): number {
  return valuesList.filter((values) =>
    before.some((prop) => isLost(prop, after.find((p) => p.id === prop.id), values[prop.id])),
  ).length;
}

// Change le type d'une propriété. Vers une sélection depuis du texte, les
// valeurs distinctes déjà saisies deviennent des options : la conversion les
// retrouve par leur nom.
export function changeType(
  prop: Property,
  type: PropertyType,
  valuesList: readonly Values[],
  makeId: (prefix: string) => string = localId,
): Property {
  const next: Property = { id: prop.id, name: prop.name, type };
  if (!isOptionType(type)) return next;
  // Un statut range toujours ses options dans un groupe (à faire par défaut) ;
  // une sélection n'en porte pas, même si elle vient d'un statut.
  // La liste n'est recopiée que si un groupe doit apparaître ou disparaître :
  // entre deux types qui n'en portent pas, elle reste la même.
  const settle = (options: SelectOption[]): SelectOption[] => {
    if (type === "status") {
      return options.every((option) => option.group) ? options : options.map((option) => ({ ...option, group: option.group ?? "todo" }));
    }
    if (options.every((option) => option.group === undefined)) return options;
    return options.map((option) => {
      const copy = { ...option };
      delete copy.group;
      return copy;
    });
  };
  if (prop.options) {
    next.options = settle(prop.options);
    return next;
  }
  const options: SelectOption[] = [];
  const seen = new Set<string>();
  for (const values of valuesList) {
    const text = valueText(prop, values[prop.id]).trim();
    for (const name of type === "multiselect" ? splitNames(text) : [text]) {
      if (!name || name.length > LIMITS.name || seen.has(fold(name)) || options.length >= LIMITS.options) continue;
      seen.add(fold(name));
      const option: SelectOption = { id: makeId("opt"), name, color: nextColor(options) };
      if (type === "status") option.group = "todo";
      options.push(option);
    }
  }
  next.options = settle(options);
  return next;
}

// Liste complète de propriétés après l'ajout d'une option à l'une d'elles.
// Une option de statut naît dans le groupe « À faire ».
export function withNewOption(
  properties: readonly Property[],
  propId: string,
  name: string,
  makeId: (prefix: string) => string = localId,
): { properties: Property[]; option: SelectOption } | null {
  const prop = properties.find((p) => p.id === propId);
  const trimmed = name.trim();
  if (!prop || !isOptionType(prop.type) || !trimmed || trimmed.length > LIMITS.name) return null;
  if (optionByName(prop, trimmed)) return null;
  const options = prop.options ?? [];
  const option: SelectOption = { id: makeId("opt"), name: trimmed, color: nextColor(options) };
  if (prop.type === "status") option.group = "todo";
  return {
    option,
    properties: properties.map((p) => (p.id === propId ? { ...p, options: [...options, option] } : p)),
  };
}

// --- Vues ------------------------------------------------------------------

function filterProp(id: string, properties: readonly Property[]): Property | undefined {
  return id === TITLE_PROP.id ? TITLE_PROP : properties.find((prop) => prop.id === id);
}

function matchesFilter(entry: EntryRow, filter: Filter, properties: readonly Property[]): boolean {
  const prop = filterProp(filter.prop, properties);
  if (!prop) return true;
  const value = prop === TITLE_PROP ? normalizeValue(prop, entry.title) : normalizeValue(prop, entry.values[prop.id]);
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
  switch (filter.op) {
    case "contains":
      return prop.type === "multiselect"
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
    case "date":
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        return typeof value === "string" ? Date.parse(value) : undefined;
      };
    // Une sélection se trie dans l'ordre de ses options, pas par ordre alphabétique ;
    // un statut, dans l'ordre de ses colonnes (groupes puis options).
    case "status":
    case "select":
    case "multiselect":
      return (entry) => {
        const value = normalizeValue(prop, entry.values[prop.id]);
        if (value === undefined) return undefined;
        const ids = Array.isArray(value) ? value : [value as string];
        const order = orderedOptions(prop);
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
    return a.manualOrder - b.manualOrder || Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

export type Column = { key: string | null; name: string; color: OptionColor | null; entries: EntryRow[] };

// « Statut » → « Sans statut » ; un sigle (« TVA ») garde sa casse.
function withoutLabel(name: string): string {
  const lower = name.length > 1 && name[1] === name[1].toLowerCase() ? name[0].toLowerCase() + name.slice(1) : name;
  return `Sans ${lower}`;
}

// Colonnes Kanban : « Sans … » d'abord, puis une par option dans l'ordre des
// options (groupées pour un statut), même vide. Les entrées gardent l'ordre reçu.
export function groupEntries(entries: readonly EntryRow[], prop: Property): Column[] {
  const columns: Column[] = [
    { key: null, name: withoutLabel(prop.name), color: null, entries: [] },
    ...orderedOptions(prop).map((option) => ({ key: option.id, name: option.name, color: option.color, entries: [] as EntryRow[] })),
  ];
  const byKey = new Map(columns.map((column) => [column.key, column]));
  for (const entry of entries) {
    const value = normalizeValue(prop, entry.values[prop.id]);
    (byKey.get(typeof value === "string" ? value : null) ?? columns[0]).entries.push(entry);
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
