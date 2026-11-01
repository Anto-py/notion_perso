// Relations entre bases : la jumelle d'une relation réciproque (étape 10,
// palier b). Module pur, sans accès à la base : la lecture et l'écriture des
// jumelles sont dans relation_query.ts, l'orchestration dans databases.ts.
//
// Une jumelle n'est pas une valeur : c'est une propriété du schéma de la base
// cible, marquée twinOf, dont la valeur se recalcule à chaque lecture en
// cherchant les entrées déclarantes qui citent l'entrée. Seul le côté qui
// déclare la relation stocke quelque chose.
import { localId, uniqueName, type Property } from "./property_schema";

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
