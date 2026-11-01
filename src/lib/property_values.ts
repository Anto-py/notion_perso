// Propriétés des bases, les valeurs : normalisation, contrôle, forme texte,
// conversion quand une propriété change, report vers une autre base, pertes
// annoncées avant confirmation, changement de type.
import { isIsoDate, isTimestamp, parseNumber } from "./property_format";
import {
  ID_PATTERN,
  LIMITS,
  fold,
  isOptionType,
  isRecord,
  isSingleOptionType,
  isTimeType,
  localId,
  nextColor,
  optionById,
  optionByName,
  rollupResultType,
  type Property,
  type PropertyType,
  type SelectOption,
  type Value,
  type Values,
} from "./property_schema";

const TRUTHY = new Set(["oui", "vrai", "true", "yes", "x", "1"]);

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
    // Une relation est un ensemble d'ids : l'ordre d'ajout est gardé, un id
    // répété ne compte qu'une fois, et « une seule entrée » ne garde que la
    // première.
    case "relation": {
      if (!Array.isArray(raw)) return undefined;
      const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id)))];
      const kept = prop.single ? ids.slice(0, 1) : ids.slice(0, LIMITS.links);
      return kept.length > 0 ? kept : undefined;
    }
    // Un cumul ne stocke aucune valeur : cette branche relit celle que
    // fillRollups calcule à la lecture, pour l'affichage, le tri et le pied
    // de tableau. L'écriture reste refusée par checkValue.
    case "rollup": {
      if (rollupResultType(prop.calc) === "date") return typeof raw === "string" && isIsoDate(raw) ? raw : undefined;
      return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) < LIMITS.number ? raw : undefined;
    }
  }
}

// Les valeurs stockées d'une entrée, telles quelles.
export function asValues(raw: unknown): Values {
  return isRecord(raw) ? (raw as Values) : {};
}

// Les valeurs d'une entrée, réduites aux propriétés de la base.
export function normalizeValues(properties: readonly Property[], raw: unknown): Values {
  const source = asValues(raw);
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
    // L'existence des entrées citées et l'appartenance à la base cible se
    // vérifient en base, pas ici (databases.ts, checkRelationTargets).
    // Une jumelle ne stocke rien : sa valeur se calcule, une saisie ordinaire
    // est refusée (l'écriture depuis la jumelle passe par updateEntry).
    case "relation":
      if (prop.twinOf) return `${prop.name} : propriété calculée, non modifiable ici`;
      return Array.isArray(raw) &&
        raw.length <= LIMITS.links &&
        raw.every((id) => typeof id === "string" && ID_PATTERN.test(id)) &&
        (!prop.single || raw.length <= 1)
        ? null
        : `${prop.name} : entrées liées invalides`;
    // Calculé à la lecture, jamais saisi.
    case "rollup":
      return `${prop.name} : propriété calculée, en lecture seule`;
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
    // Les titres liés entrent dans la recherche par une jointure à la
    // lecture, jamais dans values_text : aucun id ne s'y écrit, donc aucun
    // titre n'y vieillit (SPECS, « Relations et cumuls »).
    case "relation":
    // Un cumul ne s'écrit pas dans values_text : son résultat est calculé, il
    // n'a rien à faire dans la recherche plein-texte.
    case "rollup":
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
  // Changer la base cible d'une relation perd ses valeurs : un id d'entrée
  // n'a de sens que dans sa base. La perte est annoncée avant confirmation.
  if (from.type === "relation" && to.type === "relation" && from.target !== to.target) return undefined;
  // Une valeur calculée ne se convertit ni ne se saisit : entrer ou sortir
  // d'un cumul abandonne la valeur.
  if (from.type === "rollup" || to.type === "rollup") return undefined;
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
    // Aucun texte ne se convertit en lien vers une entrée : la valeur est
    // perdue, et la perte annoncée avant confirmation.
    case "relation":
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
    // Créé le, Modifié le : rien de stocké, rien à reporter. Une jumelle se
    // recalcule dans sa base, elle ne suit pas une entrée qui la quitte. Un
    // cumul n'a pas de valeur à reporter non plus.
    if (isTimeType(target.type) || target.twinOf || target.type === "rollup") continue;
    const source = from.find((prop) => fold(prop.name) === fold(target.name));
    if (!source || source.type !== target.type || values[source.id] === undefined) continue;
    // Deux relations ne se reportent que si elles désignent la même base :
    // un id d'entrée n'a de sens que dans sa base.
    if (target.type === "relation" && source.target !== target.target) continue;
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
    // Une jumelle n'a pas de valeur à migrer ; une valeur fantôme héritée
    // d'une ancienne version ne doit pas revenir. Un cumul non plus.
    if (prop.twinOf || prop.type === "rollup") continue;
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
  // Une jumelle et un cumul ne stockent rien : les retirer ne perd aucune
  // saisie.
  if (before.twinOf || before.type === "rollup") return false;
  const current = normalizeValue(before, value);
  if (current === undefined) return false;
  if (!after) return true;
  const next = convertValue(before, after, current);
  if (next === undefined) return true;
  if (before.type === after.type) {
    // Une relation limitée à une entrée perd les puces suivantes.
    if (before.type === "relation" || before.type === "multiselect") {
      return (next as string[]).length < (current as string[]).length;
    }
    return false;
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
  if (type === "number" || type === "rollup") next.format = prop.format ?? "number";
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
