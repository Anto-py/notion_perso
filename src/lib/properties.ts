// Propriétés des bases : types, valeurs, filtre, tri, regroupement Kanban.
// Module pur, importé par le serveur (validation, migration des valeurs)
// comme par le navigateur (affichage, filtre, tri, confirmation avant une
// perte de valeurs). Les vues et la configuration sont dans views.ts.
// Formats jsonb : BRAINSTORMING §3-4.
import { compareKeys } from "./order_key";

export const PROPERTY_TYPES = [
  "text",
  "number",
  "url",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "created_time",
  "updated_time",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const TYPE_LABELS: Record<PropertyType, string> = {
  text: "Texte",
  number: "Nombre",
  url: "Lien",
  date: "Date",
  select: "Sélection",
  multiselect: "Sélection multiple",
  checkbox: "Case à cocher",
  created_time: "Créé le",
  updated_time: "Modifié le",
};

// Créé le, Modifié le : valeur tirée de created_at et updated_at de l'entrée,
// jamais stockée ni saisie (withTimes l'ajoute aux valeurs lues).
export function isTimeType(type: PropertyType): boolean {
  return type === "created_time" || type === "updated_time";
}

export const NUMBER_FORMATS = ["number", "euro", "percent"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const FORMAT_LABELS: Record<NumberFormat, string> = { number: "Nombre", euro: "Euro", percent: "Pourcentage" };

// Les types qui portent une liste d'options.
export function isOptionType(type: PropertyType): boolean {
  return type === "select" || type === "multiselect";
}

// Types à valeur unique choisie dans une liste d'options.
export function isSingleOptionType(type: PropertyType): boolean {
  return type === "select";
}

// Types sur lesquels un Kanban peut se regrouper : ceux dont les valeurs sont
// discrètes (une option, une combinaison d'options, coché ou non). Le texte
// libre, les liens et les dates restent hors du Kanban.
export function isGroupableType(type: PropertyType): boolean {
  return type === "select" || type === "multiselect" || type === "checkbox";
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

export type SelectOption = { id: string; name: string; color: OptionColor };
// format : Nombre seulement, « number » à défaut.
export type Property = { id: string; name: string; type: PropertyType; options?: SelectOption[]; format?: NumberFormat };

// text, url, date (AAAA-MM-JJ), select (id d'option) : chaîne ;
// multiselect : liste d'ids ; checkbox : true ; number : nombre fini ;
// created_time, updated_time : horodatage ISO, ajouté à la lecture. Une
// valeur vide est absente.
export type Value = string | string[] | boolean | number;
export type Values = Record<string, Value>;

export const FILTER_OPS = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "eq",
  "neq",
  "gt",
  "lt",
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
  number: ["eq", "neq", "gt", "lt", "is_empty", "is_not_empty"],
  url: ["contains", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  multiselect: ["contains", "not_contains", "is_empty", "is_not_empty"],
  checkbox: ["checked", "unchecked"],
  // Comparées au jour (heure de Bruxelles) ; jamais vides.
  created_time: ["is", "before", "after"],
  updated_time: ["is", "before", "after"],
};

export const OP_LABELS: Record<FilterOp, string> = {
  contains: "contient",
  not_contains: "ne contient pas",
  is: "est",
  is_not: "n'est pas",
  eq: "=",
  neq: "≠",
  gt: ">",
  lt: "<",
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
// Une entrée telle que la lisent les vues (dates en ISO).
export type EntryRow = {
  id: string;
  title: string;
  icon: string | null;
  values: Values;
  manualOrder: string;
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

export const LIMITS = { properties: 50, options: 200, name: 100, text: 5000, url: 2048, filters: 20, sorts: 5, number: 1e15 };

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUTHY = new Set(["oui", "vrai", "true", "yes", "x", "1"]);
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Comparaison insensible à la casse et aux accents (« Évaluation » = « evaluation »).
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// --- Nombres et heures ------------------------------------------------------

// Saisie d'un nombre à la française ou à l'anglaise : « 1 234,5 », « 1234.5 »,
// « 12 % », « 3,50 € ». Avec une virgule, les points sont des séparateurs de
// milliers ; sans virgule, le point est décimal. null si ce n'est pas un nombre.
export function parseNumber(text: string): number | null {
  let cleaned = text.replace(/[\s\u00a0\u202f€%+]/g, "");
  if (cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && Math.abs(value) < LIMITS.number ? value : null;
}

// Écriture d'un nombre à la française, à la main plutôt que par Intl : le
// serveur et le navigateur rendent le même texte (hydratation). Espace fine
// insécable entre les milliers, virgule décimale ; l'euro garde deux
// décimales, les autres formats au plus maxDecimals (bruit des flottants
// effacé).
export function formatNumber(value: number, format: NumberFormat = "number", maxDecimals = 10): string {
  const fixed = format === "euro" ? value.toFixed(2) : String(Number(value.toFixed(maxDecimals)));
  if (/e/i.test(fixed)) return fixed;
  const negative = fixed.startsWith("-");
  const [int, dec] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  const text = `${negative && fixed !== "-0" ? "-" : ""}${grouped}${dec ? `,${dec}` : ""}`;
  if (format === "euro") return `${text}\u00a0€`;
  if (format === "percent") return `${text}\u00a0%`;
  return text;
}

// Jour et heure d'un horodatage à Bruxelles, en chiffres : formatToParts ne
// rend que des nombres, identiques côté serveur et navigateur.
const BRUSSELS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function brusselsParts(iso: string): { day: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const parts = Object.fromEntries(BRUSSELS.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function isTimestamp(raw: unknown): raw is string {
  return typeof raw === "string" && raw.includes("T") && !Number.isNaN(Date.parse(raw));
}

// Valeurs d'une entrée complétées de ses propriétés Créé le et Modifié le.
// Appelé à l'affichage seulement : ces valeurs ne s'écrivent jamais en base.
export function withTimes(properties: readonly Property[], values: Values, times: { createdAt: string; updatedAt: string }): Values {
  const timed = properties.filter((prop) => isTimeType(prop.type));
  if (timed.length === 0) return values;
  const next = { ...values };
  for (const prop of timed) next[prop.id] = prop.type === "created_time" ? times.createdAt : times.updatedAt;
  return next;
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

// Options de départ d'une sélection créée pour grouper un Kanban : sans
// option, elle n'aurait qu'une colonne « Sans … ».
export function defaultSelectOptions(makeId: (prefix: string) => string = localId): SelectOption[] {
  return [
    { id: makeId("opt"), name: "À faire", color: "gray" },
    { id: makeId("opt"), name: "En cours", color: "yellow" },
    { id: makeId("opt"), name: "Terminé", color: "green" },
  ];
}

export function optionById(prop: Property, id: string): SelectOption | undefined {
  return prop.options?.find((option) => option.id === id);
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
    if (prop.type === "number") {
      prop.format = (NUMBER_FORMATS as readonly unknown[]).includes(item.format) ? (item.format as NumberFormat) : "number";
    }
    if (isOptionType(prop.type)) {
      const options = validateOptions(item.options ?? []);
      if (typeof options === "string") return `${name} : ${options}`;
      prop.options = options;
    }
    properties.push(prop);
  }
  return properties;
}

function validateOptions(raw: unknown): SelectOption[] | string {
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
    options.push({ id, name, color: color as OptionColor });
  }
  return options;
}

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
    case "select":
      return typeof raw === "string" && optionById(prop, raw) ? raw : undefined;
    case "multiselect": {
      if (!Array.isArray(raw)) return undefined;
      const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && !!optionById(prop, id)))];
      return ids.length > 0 ? ids : undefined;
    }
    case "checkbox":
      return raw === true ? true : undefined;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) < LIMITS.number ? raw : undefined;
    case "created_time":
    case "updated_time":
      return isTimestamp(raw) ? raw : undefined;
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
    case "select":
      return raw === "" || (typeof raw === "string" && optionById(prop, raw)) ? null : `${prop.name} : option inconnue, rechargez la page`;
    case "multiselect":
      return Array.isArray(raw) && raw.every((id) => typeof id === "string" && optionById(prop, id))
        ? null
        : `${prop.name} : option inconnue, rechargez la page`;
    case "checkbox":
      return typeof raw === "boolean" ? null : `${prop.name} : vrai ou faux attendu`;
    case "number":
      return normalizeValue(prop, raw) !== undefined ? null : `${prop.name} : nombre attendu`;
    case "created_time":
    case "updated_time":
      return `${prop.name} : valeur en lecture seule`;
  }
}

// Forme texte canonique d'une valeur : recherche (values_text), conversion
// de type, filtre « contient ». Une date reste en AAAA-MM-JJ, un nombre
// s'écrit sans séparateur de milliers (« 1234,5 »). Créé le et Modifié le
// n'en ont pas : ni recherchés, ni convertis.
export function valueText(prop: Property, value: unknown): string {
  const normalized = normalizeValue(prop, value);
  if (normalized === undefined) return "";
  switch (prop.type) {
    case "checkbox":
      return "Oui";
    case "select":
      return optionById(prop, normalized as string)?.name ?? "";
    case "multiselect":
      return (normalized as string[]).map((id) => optionById(prop, id)?.name ?? "").join(", ");
    case "number":
      return String(normalized).replace(".", ",");
    case "created_time":
    case "updated_time":
      return "";
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
  // Une valeur unique choisie garde son option par id, sinon par nom : le
  // passage d'un type à l'autre ne perd rien.
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
    case "select":
      return optionByName(to, text)?.id;
    case "multiselect":
      return normalizeValue(
        to,
        splitNames(text).map((name) => optionByName(to, name)?.id),
      );
    case "number":
      return parseNumber(text) ?? undefined;
    case "created_time":
    case "updated_time":
      return undefined;
  }
}

// Report des valeurs d'une entrée qui change de base. Seule une propriété de
// même nom (casse et accents ignorés) ET de même type reçoit sa valeur ; une
// sélection retrouve ses options par leur nom, puisque les ids diffèrent d'une
// base à l'autre. Rien n'est converti : un type différent laisse la valeur.
export function transferValues(from: readonly Property[], to: readonly Property[], values: Values): Values {
  const transferred: Values = {};
  for (const target of to) {
    // Créé le, Modifié le : rien de stocké, rien à reporter.
    if (isTimeType(target.type)) continue;
    const source = from.find((prop) => fold(prop.name) === fold(target.name));
    if (!source || source.type !== target.type || values[source.id] === undefined) continue;
    const current = normalizeValue(source, values[source.id]);
    if (current === undefined) continue;
    if (isOptionType(target.type)) {
      const ids = Array.isArray(current) ? current : [current as string];
      const mapped = ids.map((id) => mapOption(source, target, id)).filter((id): id is string => id !== undefined);
      const value = normalizeValue(target, Array.isArray(current) ? mapped : mapped[0]);
      if (value !== undefined) transferred[target.id] = value;
    } else {
      transferred[target.id] = current;
    }
  }
  return transferred;
}

// Propriété de la source qui n'a pas d'accueil dans la cible : même nom et
// même type, sinon sa valeur n'a plus de case où vivre.
export type Orphan = { name: string; type: PropertyType; text: string };

// Valeurs qui ne suivront pas le déplacement. Elles sont écrites dans le corps
// de la page par moveEntry, plutôt que perdues en silence. Une propriété
// accueillie dont l'option n'existe pas dans la cible compte aussi comme
// orpheline : transferValues l'a laissée derrière.
export function orphanValues(
  from: readonly Property[],
  to: readonly Property[],
  values: Values,
  transferred: Values = transferValues(from, to, values),
): Orphan[] {
  const orphans: Orphan[] = [];
  for (const prop of from) {
    const value = normalizeValue(prop, values[prop.id]);
    if (value === undefined) continue;
    const hosted = to.find((target) => fold(target.name) === fold(prop.name) && target.type === prop.type);
    if (hosted && transferred[hosted.id] !== undefined) continue;
    const text = valueText(prop, value).trim();
    if (text) orphans.push({ name: prop.name, type: prop.type, text });
  }
  return orphans;
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
  if (type === "number") next.format = prop.format ?? "number";
  if (!isOptionType(type)) return next;
  // D'une propriété à options vers une autre, la liste est gardée telle
  // quelle ; depuis un texte, les valeurs saisies font les options.
  next.options = prop.options ?? optionsFromValues(prop, type, valuesList, makeId);
  return next;
}

// Options tirées des valeurs saisies, quand une propriété sans options (texte,
// lien…) devient une sélection : chaque texte distinct devient une option.
function optionsFromValues(
  prop: Property,
  type: PropertyType,
  valuesList: readonly Values[],
  makeId: (prefix: string) => string,
): SelectOption[] {
  const options: SelectOption[] = [];
  const seen = new Set<string>();
  for (const values of valuesList) {
    const text = valueText(prop, values[prop.id]).trim();
    for (const name of type === "multiselect" ? splitNames(text) : [text]) {
      if (!name || name.length > LIMITS.name || seen.has(fold(name)) || options.length >= LIMITS.options) continue;
      seen.add(fold(name));
      options.push({ id: makeId("opt"), name, color: nextColor(options) });
    }
  }
  return options;
}

// Liste complète de propriétés après l'ajout d'une option à l'une d'elles.
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
