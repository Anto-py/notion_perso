// Valeurs d'une entrée écrites par l'agent (SPECS.md, « Accès agent », palier
// d) : les propriétés se désignent par leur nom, sans accents ni casse. Chaque
// valeur est convertie selon le type de la propriété, une option inconnue est
// créée, une relation attend ses ids (résolus par la route, qui lit la base).
// Une seule erreur refuse toute la requête : rien n'est écrit à moitié.
import { parseNumber } from "./property_format.ts";
import {
  LIMITS,
  fold,
  localId,
  optionByName,
  type Property,
  type Value,
} from "./property_schema.ts";
import { checkValue, withNewOption } from "./property_values.ts";

export type AgentRaw = string | number | boolean | string[];
export type AgentValues = Record<string, AgentRaw>;

// Ce que la route a trouvé pour une relation : les ids des entrées visées, ou
// le refus lisible (titre absent, ambigu).
export type RelationAnswers = Map<string, { ids: string[] } | { error: string }>;

export type AgentResolution =
  | { ok: true; values: Record<string, Value | null>; properties: Property[]; created: string[] }
  | { ok: false; error: string };

const TRUTHY = new Set(["oui", "vrai", "true", "yes", "x", "1"]);
const FALSY = new Set(["non", "faux", "false", "no", "0"]);

// Liste de noms : un tableau, ou une chaîne à virgules (« a, b »). null si la
// forme ne s'y prête pas.
export function toList(raw: AgentRaw): string[] | null {
  if (Array.isArray(raw)) return raw.every((item) => typeof item === "string") ? raw.map((item) => item.trim()).filter(Boolean) : null;
  if (typeof raw === "string") return raw.split(",").map((item) => item.trim()).filter(Boolean);
  return null;
}

// Le corps JSON de la route : un objet de scalaires ou de listes de chaînes.
export function readAgentValues(raw: unknown): AgentValues | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "values invalide";
  const values: AgentValues = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[name] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) values[name] = value;
    else return `Valeur invalide pour « ${name} »`;
  }
  return values;
}

function propertyNamed(properties: readonly Property[], name: string): Property | undefined {
  const wanted = fold(name);
  return properties.find((prop) => fold(prop.name) === wanted);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// Valeurs normalisées par id de propriété, schéma après création des options
// inconnues, et noms de ces options pour la réponse.
export function resolveAgentValues(
  properties: readonly Property[],
  raw: AgentValues,
  answers: RelationAnswers = new Map(),
  makeId: (prefix: string) => string = localId,
): AgentResolution {
  let current: Property[] = [...properties];
  const values: Record<string, Value | null> = {};
  const created: string[] = [];

  for (const [name, input] of Object.entries(raw)) {
    const prop = propertyNamed(current, name);
    if (!prop) return fail(`Propriété inconnue : « ${name} »`);

    let value: Value | null;
    switch (prop.type) {
      case "text":
      case "url": {
        if (typeof input !== "string") return fail(`${prop.name} : texte attendu`);
        value = input.trim() === "" ? null : input;
        break;
      }
      case "number": {
        if (input === "") value = null;
        else if (typeof input === "number") value = input;
        else if (typeof input === "string") {
          const parsed = parseNumber(input);
          if (parsed === null) return fail(`${prop.name} : nombre illisible « ${input} »`);
          value = parsed;
        } else return fail(`${prop.name} : nombre attendu`);
        break;
      }
      case "date": {
        if (typeof input !== "string") return fail(`${prop.name} : date attendue (AAAA-MM-JJ)`);
        value = input.trim() === "" ? null : input.trim();
        break;
      }
      case "checkbox": {
        if (typeof input === "boolean") value = input;
        else if (typeof input === "string") {
          const text = fold(input.trim());
          if (text === "") value = null;
          else if (TRUTHY.has(text)) value = true;
          else if (FALSY.has(text)) value = false;
          else return fail(`${prop.name} : oui ou non attendu`);
        } else return fail(`${prop.name} : oui ou non attendu`);
        break;
      }
      case "select": {
        if (typeof input !== "string") return fail(`${prop.name} : nom d'option attendu`);
        const option = input.trim();
        if (!option) {
          value = null;
          break;
        }
        const existing = optionByName(prop, option);
        if (existing) {
          value = existing.id;
          break;
        }
        if (option.length > LIMITS.name) return fail(`${prop.name} : option trop longue`);
        const added = withNewOption(current, prop.id, option, makeId);
        if (!added) return fail(`${prop.name} : option « ${option} » refusée`);
        current = added.properties;
        created.push(`${prop.name} : ${added.option.name}`);
        value = added.option.id;
        break;
      }
      case "multiselect": {
        const names = toList(input);
        if (!names) return fail(`${prop.name} : liste d'options attendue`);
        const ids: string[] = [];
        for (const option of names) {
          const live = current.find((item) => item.id === prop.id)!;
          const existing = optionByName(live, option);
          if (existing) {
            if (!ids.includes(existing.id)) ids.push(existing.id);
            continue;
          }
          if (option.length > LIMITS.name) return fail(`${prop.name} : option trop longue`);
          const added = withNewOption(current, prop.id, option, makeId);
          if (!added) return fail(`${prop.name} : option « ${option} » refusée`);
          current = added.properties;
          created.push(`${prop.name} : ${added.option.name}`);
          if (!ids.includes(added.option.id)) ids.push(added.option.id);
        }
        value = ids.length ? ids : null;
        break;
      }
      case "relation": {
        if (prop.twinOf) return fail(`${prop.name} : propriété calculée, non modifiable`);
        const titles = toList(input);
        if (!titles) return fail(`${prop.name} : titres d'entrées attendus`);
        if (!titles.length) {
          value = null;
          break;
        }
        const answer = answers.get(prop.id);
        if (!answer) return fail(`${prop.name} : relations non résolues`);
        if ("error" in answer) return fail(answer.error);
        value = answer.ids;
        break;
      }
      case "created_time":
      case "updated_time":
      case "rollup":
        return fail(`${prop.name} : propriété en lecture seule`);
    }

    const live = current.find((item) => item.id === prop.id)!;
    const problem = checkValue(live, value);
    if (problem) return fail(problem);
    values[prop.id] = value;
  }

  return { ok: true, values, properties: current, created };
}
