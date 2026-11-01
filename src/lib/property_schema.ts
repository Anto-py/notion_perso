// Propriétés des bases, le vocabulaire : types, libellés, limites, options,
// validation d'une liste de propriétés. Ne dépend d'aucun autre module des
// propriétés (properties.ts réexporte l'ensemble).

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
  "relation",
  "rollup",
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
  relation: "Relation",
  rollup: "Cumul",
};

// Créé le, Modifié le : valeur tirée de created_at et updated_at de l'entrée,
// jamais stockée ni saisie (withTimes l'ajoute aux valeurs lues).
export function isTimeType(type: PropertyType): boolean {
  return type === "created_time" || type === "updated_time";
}

export const NUMBER_FORMATS = ["number", "euro", "percent"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const FORMAT_LABELS: Record<NumberFormat, string> = { number: "Nombre", euro: "Euro", percent: "Pourcentage" };

// Cumul (étape 10, palier c) : un calcul à travers une relation, jamais
// stocké. Les cinq premiers rendent un nombre, les deux derniers une date.
export const ROLLUP_CALCS = ["count", "count_filled", "percent", "sum", "avg", "min", "max", "oldest", "newest"] as const;
export type RollupCalc = (typeof ROLLUP_CALCS)[number];
export const ROLLUP_CALC_LABELS: Record<RollupCalc, string> = {
  count: "Compter les entrées liées",
  count_filled: "Compter les valeurs remplies",
  percent: "Part remplie",
  sum: "Somme",
  avg: "Moyenne",
  min: "Minimum",
  max: "Maximum",
  oldest: "La plus ancienne",
  newest: "La plus récente",
};
const ROLLUP_DATE_CALCS: ReadonlySet<RollupCalc> = new Set(["oldest", "newest"]);

// Type du résultat d'un cumul : une date pour les deux calculs de date, un
// nombre sinon. C'est lui qui décide des filtres, du tri et du pied de tableau.
export function rollupResultType(calc: RollupCalc | undefined): "number" | "date" {
  return calc && ROLLUP_DATE_CALCS.has(calc) ? "date" : "number";
}

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
// Jumelle d'une relation déclarante, posée par le serveur dans la base cible :
// db est la base déclarante, prop sa relation. Aucune valeur n'est stockée, la
// jumelle se lit à chaque affichage (étape 10, palier b).
export type TwinRef = { db: string; prop: string };
// format : Nombre et cumul numérique, « number » à défaut.
// target, single, reciprocal : Relation seulement. target désigne la base
// cible (elle-même comprise), single limite la valeur à une entrée,
// reciprocal demande la jumelle dans la base cible (étape 10, palier b).
// relation, calc, target : Cumul seulement. relation désigne la Relation de
// la même base à traverser, target la propriété visée dans la base cible,
// calc le calcul (étape 10, palier c). Aucune valeur n'est stockée.
export type Property = {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  format?: NumberFormat;
  target?: string;
  single?: boolean;
  reciprocal?: boolean;
  twinOf?: TwinRef;
  relation?: string;
  calc?: RollupCalc;
};

// text, url, date (AAAA-MM-JJ), select (id d'option) : chaîne ;
// multiselect et relation : liste d'ids ; checkbox : true ; number : nombre
// fini ; created_time, updated_time : horodatage ISO, ajouté à la lecture.
// Une valeur vide est absente.
export type Value = string | string[] | boolean | number;
export type Values = Record<string, Value>;

// Entrée citée par une relation, telle que la lisent les puces : son titre et
// son icône sont lus à chaque affichage, jamais recopiés dans la valeur.
// publicBaseId : identifiant public de sa base, quand elle est publiée ; c'est
// ce qui décide d'un lien dans la vue publique.
export type LinkRef = {
  id: string;
  title: string;
  icon: string | null;
  trashed: boolean;
  publicBaseId: string | null;
};

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
  // « contient » porte l'id d'une entrée de la base cible.
  relation: ["contains", "is_empty", "is_not_empty"],
  // Jamais lue directement : les opérateurs d'un cumul sont ceux du type de
  // son résultat, rendus par filterOpsFor.
  rollup: [],
};

// Opérateurs d'un filtre sur une propriété. Un cumul emprunte ceux de son
// résultat (Nombre ou Date), pas ceux de son type de schéma.
export function filterOpsFor(prop: Property): FilterOp[] {
  return prop.type === "rollup" ? OPS_BY_TYPE[rollupResultType(prop.calc)] : OPS_BY_TYPE[prop.type];
}

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
  // Galerie (étape 9) : bandeau de l'entrée ("image:<fichier>" ou
  // "color:<teinte>") et première image de son corps, lue en SQL. Absentes
  // quand le producteur n'en a pas besoin.
  cover?: string | null;
  bodyImage?: string | null;
  // Relation (étape 10) : les entrées citées, résolues à la lecture, par id
  // de propriété. Un id purgé n'a pas d'entrée ici.
  links?: Record<string, LinkRef[]>;
  // Cumul (étape 10) : ids des cumuls dont la cible a disparu ou changé de
  // type. La cellule affiche un tiret et l'en-tête le signale.
  brokenRollups?: string[];
};

// Le titre de l'entrée est le titre de sa page : une colonne fixe, filtrable
// et triable comme une propriété texte, mais jamais rangée parmi elles.
export const TITLE_PROP: Property = { id: "title", name: "Titre", type: "text" };

export const SORT_BUILTINS: Record<string, string> = {
  title: "Titre",
  created_at: "Date de création",
  updated_at: "Dernière modification",
};

export const LIMITS = {
  properties: 50,
  options: 200,
  name: 100,
  text: 5000,
  url: 2048,
  filters: 20,
  sorts: 5,
  number: 1e15,
  // Entrées citées par une relation.
  links: 1000,
};

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTwinRef(value: unknown): value is TwinRef {
  return isRecord(value) && typeof value.db === "string" && typeof value.prop === "string";
}

// Une jumelle est une relation, mais qui ne se saisit pas : sa valeur se
// calcule. Les branches de saisie s'appuient sur cette garde.
export function isTwin(prop: Property): prop is Property & { twinOf: TwinRef } {
  return prop.type === "relation" && isTwinRef(prop.twinOf);
}

export function isRollup(prop: Property): prop is Property & { type: "rollup" } {
  return prop.type === "rollup";
}

// Propriétés sans valeur saisissable : la jumelle et le cumul se calculent,
// l'écriture y est refusée et les migrations les sautent.
export function isComputed(prop: Property): boolean {
  return prop.type === "rollup" || isTwin(prop);
}

// Une propriété dont la valeur se compare comme un nombre : le Nombre, et un
// cumul numérique. Le pied de tableau et les filtres s'appuient dessus.
export function isNumberProp(prop: Property): boolean {
  return prop.type === "number" || (prop.type === "rollup" && rollupResultType(prop.calc) === "number");
}

export function isDateProp(prop: Property): boolean {
  return prop.type === "date" || (prop.type === "rollup" && rollupResultType(prop.calc) === "date");
}

// Comparaison insensible à la casse et aux accents (« Évaluation » = « evaluation »).
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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

export function optionByName(prop: Property, name: string): SelectOption | undefined {
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
    if (prop.type === "relation") {
      if (typeof item.target !== "string" || !ID_PATTERN.test(item.target)) return `${name} : base cible attendue`;
      prop.target = item.target;
      // Une jumelle est posée par le serveur : elle n'est ni réciproque ni
      // limitée, et son nom suit la relation déclarante. Un twinOf mal formé
      // est ignoré, la prochaine écriture rétablissant la cohérence.
      if (isTwinRef(item.twinOf) && ID_PATTERN.test(item.twinOf.db) && ID_PATTERN.test(item.twinOf.prop)) {
        prop.twinOf = { db: item.twinOf.db, prop: item.twinOf.prop };
        prop.single = false;
        prop.reciprocal = false;
      } else {
        prop.single = item.single === true;
        prop.reciprocal = item.reciprocal === true;
      }
    }
    // Un cumul peut rester incomplet le temps de sa configuration : relation
    // et propriété visée facultatives, calcul « count » à défaut. Ce qui
    // manque se voit à la lecture (tiret et en-tête signalé), jamais ici.
    if (prop.type === "rollup") {
      prop.calc = (ROLLUP_CALCS as readonly unknown[]).includes(item.calc) ? (item.calc as RollupCalc) : "count";
      prop.format = (NUMBER_FORMATS as readonly unknown[]).includes(item.format) ? (item.format as NumberFormat) : "number";
      if (typeof item.relation === "string" && ID_PATTERN.test(item.relation)) prop.relation = item.relation;
      if (typeof item.target === "string" && ID_PATTERN.test(item.target)) prop.target = item.target;
    }
    properties.push(prop);
  }
  // La relation traversée, quand elle est nommée, doit exister dans la même
  // base, être une relation et ne pas être une jumelle : un cumul lit la
  // relation qui déclare le lien, jamais une relation calculée. Un cumul de
  // cumul n'existe pas.
  for (const prop of properties) {
    if (prop.type !== "rollup" || !prop.relation) continue;
    const source = properties.find((item) => item.id === prop.relation);
    if (!source || source.type !== "relation" || source.twinOf) return `${prop.name} : relation à traverser introuvable`;
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
