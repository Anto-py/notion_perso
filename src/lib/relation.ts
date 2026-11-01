// Relations entre bases : la jumelle d'une relation réciproque (étape 10,
// palier b). Module pur, sans accès à la base : la lecture et l'écriture des
// jumelles sont dans relation_query.ts, l'orchestration dans databases.ts.
//
// Une jumelle n'est pas une valeur : c'est une propriété du schéma de la base
// cible, marquée twinOf, dont la valeur se recalcule à chaque lecture en
// cherchant les entrées déclarantes qui citent l'entrée. Seul le côté qui
// déclare la relation stocke quelque chose.
import { localId, rollupResultType, uniqueName, type Property, type RollupCalc, type Value } from "./property_schema";

// Les jumelles dérivées de la base `declaringDb`, dans l'ordre où elles
// apparaissent. Les propriétés ordinaires et les jumelles des autres bases
// sont laissées telles quelles.
export function mergeTwins(
  current: readonly Property[],
  declaringDb: string,
  declaring: readonly Property[],
): Property[] {
  const wanted = new Map(
    declaring
      .filter((prop) => prop.type === "relation" && prop.reciprocal === true && typeof prop.target === "string")
      .map((prop) => [prop.id, prop]),
  );
  // Tous les noms déjà pris : propriétés ordinaires et jumelles d'autres
  // bases, où qu'elles soient placées. Sans cela, une jumelle recréée
  // entrerait en collision avec une propriété lue plus loin.
  const taken: Property[] = current.filter((prop) => prop.twinOf?.db !== declaringDb);
  const rebuilt: Property[] = [];
  const placed = new Set<string>();
  for (const prop of current) {
    if (prop.twinOf?.db !== declaringDb) {
      rebuilt.push(prop);
      continue;
    }
    const decl = wanted.get(prop.twinOf.prop);
    // La relation a disparu ou perdu sa réciprocité : sa jumelle aussi.
    if (!decl) continue;
    const twin = twinProperty(decl, declaringDb, taken, prop);
    rebuilt.push(twin);
    taken.push(twin);
    placed.add(decl.id);
  }
  for (const [id, decl] of wanted) {
    if (placed.has(id)) continue;
    const twin = twinProperty(decl, declaringDb, taken);
    rebuilt.push(twin);
    taken.push(twin);
  }
  return rebuilt;
}

// La jumelle d'une relation déclarante. `taken` ne doit pas contenir la
// jumelle elle-même, sans quoi elle se suffixerait à chaque passage. Son nom
// suit celui de la déclarante, avec un suffixe en cas de collision ; son id
// est conservé pour qu'elle garde sa place.
export function twinProperty(
  decl: Property,
  declaringDb: string,
  taken: readonly Property[],
  existing?: Property,
  makeId: (prefix: string) => string = localId,
): Property {
  return {
    id: existing?.id ?? makeId("prop"),
    name: uniqueName(taken, decl.name),
    type: "relation",
    target: declaringDb,
    single: false,
    twinOf: { db: declaringDb, prop: decl.id },
  };
}

// Identifiants à ajouter et à retirer pour passer de `current` à `wanted`.
export function relationDelta(
  current: readonly string[],
  wanted: readonly string[],
): { add: string[]; remove: string[] } {
  const have = new Set(current);
  const want = new Set(wanted);
  return {
    add: [...want].filter((id) => !have.has(id)),
    remove: [...have].filter((id) => !want.has(id)),
  };
}

// Une entrée liée, du point de vue du cumul : la valeur déjà normalisée de la
// propriété visée, undefined quand elle est vide.
export type RollupSource = { value: Value | undefined };

// Résultat d'un cumul (étape 10, palier c), calculé à chaque lecture. `target`
// est la propriété visée, lue dans la base cible ; null quand elle a disparu.
// `sources` ne contient que les entrées liées qui vivent encore : une entrée
// en corbeille ou purgée cesse de compter.
//
// Règles de bord : un compte d'ensemble vide vaut 0 (l'information « rien de
// lié »), une part remplie sur zéro entrée reste vide plutôt que de diviser
// par zéro, une somme sans valeur vaut 0, une moyenne ou un extrême sans
// valeur reste vide. Une cible absente ou d'un type incompatible avec le
// calcul rend null : la cellule montre un tiret.
// La propriété visée convient-elle au calcul ? « count » n'en a pas besoin,
// les comptes de remplissage acceptent tout type, les autres exigent le type
// du résultat (nombre ou date).
export function targetFits(calc: RollupCalc, target: Property | null): boolean {
  if (calc === "count") return true;
  if (!target) return false;
  if (calc === "count_filled" || calc === "percent") return true;
  return target.type === (rollupResultType(calc) === "date" ? "date" : "number");
}

export function computeRollup(calc: RollupCalc, target: Property | null, sources: readonly RollupSource[]): Value | null {
  if (calc === "count") return sources.length;
  if (calc === "count_filled") return sources.filter((source) => source.value !== undefined).length;
  if (calc === "percent") {
    if (sources.length === 0) return null;
    const filled = sources.filter((source) => source.value !== undefined).length;
    return Math.round((filled / sources.length) * 1000) / 10;
  }
  if (rollupResultType(calc) === "date") {
    if (!target || target.type !== "date") return null;
    const dates = sources.flatMap((source) => (typeof source.value === "string" ? [source.value] : []));
    if (dates.length === 0) return null;
    return calc === "oldest" ? dates.reduce((a, b) => (a < b ? a : b)) : dates.reduce((a, b) => (a > b ? a : b));
  }
  if (!target || target.type !== "number") return null;
  const numbers = sources.flatMap((source) => (typeof source.value === "number" ? [source.value] : []));
  if (calc === "sum") return numbers.reduce((total, number) => total + number, 0);
  if (numbers.length === 0) return null;
  if (calc === "avg") return numbers.reduce((total, number) => total + number, 0) / numbers.length;
  if (calc === "min") return Math.min(...numbers);
  return Math.max(...numbers);
}

// Valeur d'une relation déclarante après avoir ajouté ou retiré une entrée.
// « Une seule entrée » remplace la précédente.
export function withLink(
  decl: Property,
  current: readonly string[],
  entryId: string,
  present: boolean,
): string[] {
  if (!present) return current.filter((id) => id !== entryId);
  if (decl.single) return [entryId];
  return current.includes(entryId) ? [...current] : [...current, entryId];
}
