// CSV d'export Notion → configuration de base et lignes d'entrées. Module pur.
// Le CSV ne porte pas le type des colonnes : il se déduit des valeurs, avec des
// règles prudentes (le texte l'emporte en cas de doute, aucune donnée n'est
// perdue). Le titre est la première colonne, jamais une propriété.
import Papa from "papaparse";
import {
  fold,
  isIsoDate,
  LIMITS,
  OPTION_COLORS,
  sanitizeView,
  uniqueName,
  type DbConfig,
  type Property,
  type SelectOption,
  type Value,
  type Values,
} from "./properties";

export type CsvTable = { header: string[]; rows: string[][] };

export type CsvEntry = { title: string; values: Values; extraMarkdown: string };

export type CsvBuild = {
  config: DbConfig;
  entries: CsvEntry[];
  notes: { reason: string; count: number }[];
  ignored: { reason: string; count: number }[];
};

export type CsvContext = {
  makeId: (prefix: string) => string;
  // URL Notion connue de l'archive, avec le titre de sa page.
  resolveLink: (href: string) => { href: string; title: string } | null;
};

type ColumnKind = "checkbox" | "date" | "url" | "relation" | "select" | "multiselect" | "text";

const ENGLISH_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const FRENCH_MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const TRUTHY = new Set(["yes", "true", "oui", "vrai", "x", "1"]);
const FALSY = new Set(["no", "false", "non", "faux", "0"]);

function foldMonth(name: string): string {
  return fold(name).replace(/\.$/, "");
}

function monthIndex(name: string): number {
  const month = foldMonth(name);
  const english = ENGLISH_MONTHS.findIndex((candidate) => candidate === month || candidate.startsWith(month));
  if (english !== -1 && month.length >= 3) return english;
  return FRENCH_MONTHS.findIndex((candidate) => candidate === month || candidate.startsWith(month));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// AAAA-MM-JJ d'une date lisible ; null si le format est inconnu.
// Notion exporte les dates dans la locale du compte : ici le français, avec
// une heure facultative (« 7 février 2025 10:07 ») et des plages
// (« 19/03/2025 → 23/03/2025 », dont seule la date de début tient dans une
// valeur de type Date). Le format numérique est lu jour/mois/année, comme le
// fait la locale française ; une valeur impossible est refusée.
export function parseNotionDate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const range = trimmed.split(/\s*(?:→|->)\s*/);
  if (range.length > 1) return parseNotionDate(range[0]);

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(trimmed);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isIsoDate(date) ? date : null;
  }
  const yearFirst = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s|$)/.exec(trimmed);
  if (yearFirst) {
    const date = `${yearFirst[1]}-${pad(Number(yearFirst[2]))}-${pad(Number(yearFirst[3]))}`;
    return isIsoDate(date) ? date : null;
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(trimmed);
  if (slashed) {
    const date = `${slashed[3]}-${pad(Number(slashed[2]))}-${pad(Number(slashed[1]))}`;
    return isIsoDate(date) ? date : null;
  }
  const long = /^([A-Za-zÀ-ÿ.]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s|$)/.exec(trimmed);
  if (long) {
    const month = monthIndex(long[1]);
    if (month !== -1) {
      const date = `${long[3]}-${pad(month + 1)}-${pad(Number(long[2]))}`;
      return isIsoDate(date) ? date : null;
    }
  }
  const french = /^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})(?:\s|$)/.exec(trimmed);
  if (french) {
    const month = monthIndex(french[2]);
    if (month !== -1) {
      const date = `${french[3]}-${pad(month + 1)}-${pad(Number(french[1]))}`;
      return isIsoDate(date) ? date : null;
    }
  }
  return null;
}

export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const rows = result.data
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows.shift() ?? [];
  const width = Math.max(header.length, ...rows.map((row) => row.length), 0);
  return {
    header: Array.from({ length: width }, (_, index) => header[index] ?? ""),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
  };
}

function nonEmpty(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value !== "");
}

function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = fold(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function splitMulti(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function splitUrls(value: string): string[] {
  return value
    .split(/\s*,\s*|\s+/)
    .map((part) => part.trim())
    .filter((part) => /^(https?:\/\/|\/)/.test(part));
}

function isRelation(value: string, ctx: CsvContext): boolean {
  const urls = splitUrls(value);
  return urls.length > 0 && urls.every((url) => ctx.resolveLink(url) !== null);
}

function inferKind(values: string[], ctx: CsvContext): ColumnKind {
  const filled = nonEmpty(values);
  if (filled.length === 0) return "text";
  if (filled.every((value) => TRUTHY.has(fold(value)) || FALSY.has(fold(value)))) return "checkbox";
  if (filled.every((value) => parseNotionDate(value) !== null)) return "date";
  if (filled.every((value) => isRelation(value, ctx))) return "relation";
  if (filled.every((value) => /^https?:\/\//.test(value))) return "url";

  const short = filled.every((value) => value.length <= 60);
  const commaCells = filled.filter((value) => value.includes(",")).length;
  const fragments = filled.flatMap(splitMulti);
  const repeated = fragments.some((fragment, index) =>
    fragments.some((other, otherIndex) => otherIndex !== index && fold(other) === fold(fragment)),
  );
  const manyFragments = filled.some((value) => splitMulti(value).length >= 3);
  // Notion interdit la virgule dans une option : une sélection multiple doit
  // donc en porter dans la plupart de ses cellules, avec des fragments qui
  // reviennent. Une phrase courte à une seule virgule garde ainsi son texte.
  if (
    short &&
    commaCells * 2 >= filled.length &&
    (repeated || manyFragments) &&
    fragments.every((fragment) => fragment.length <= 30)
  ) {
    return "multiselect";
  }
  // Une sélection simple porte des valeurs courtes, sans ponctuation de phrase,
  // en nombre borné, et qui se répètent (ou remplissent une très petite base).
  const sentence = filled.some((value) => /[.,;!?]/.test(value));
  const distinctValues = distinct(filled);
  const plausible = distinctValues.length <= 20 && (distinctValues.length < filled.length || filled.length <= 5);
  if (short && !commaCells && !sentence && plausible) return "select";
  return "text";
}

function optionColor(index: number) {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

function makeOptions(names: readonly string[], makeId: (prefix: string) => string): SelectOption[] {
  return names.slice(0, LIMITS.options).map((name, index) => ({
    id: makeId("opt"),
    name: name.slice(0, LIMITS.name),
    color: optionColor(index),
  }));
}

export function buildCsvDatabase(table: CsvTable, ctx: CsvContext): CsvBuild {
  const notes: { reason: string; count: number }[] = [];
  const ignored: { reason: string; count: number }[] = [];
  const properties: Property[] = [];
  const extras: string[][] = table.rows.map(() => []);
  const rowValues: Values[] = table.rows.map(() => ({}));

  for (let column = 1; column < table.header.length; column++) {
    const values = table.rows.map((row) => row[column] ?? "");
    const filled = nonEmpty(values);
    const fallbackName = `Colonne ${column}`;
    const sourceName = (table.header[column] || fallbackName).trim() || fallbackName;

    if (filled.length === 0) {
      ignored.push({ reason: `colonne vide « ${sourceName} »`, count: 1 });
      continue;
    }
    // Au-delà de la limite, la configuration serait refusée en bloc à la
    // lecture : mieux vaut écarter la colonne et le dire.
    if (properties.length >= LIMITS.properties) {
      ignored.push({ reason: `colonne « ${sourceName} » au-delà de ${LIMITS.properties} propriétés`, count: 1 });
      continue;
    }

    const kind = inferKind(values, ctx);
    const name = uniqueName(properties, sourceName.slice(0, LIMITS.name));
    const id = ctx.makeId("prop");
    let prop: Property;
    let options: SelectOption[] = [];

    if (kind === "checkbox") {
      prop = { id, name, type: "checkbox" };
    } else if (kind === "date") {
      prop = { id, name, type: "date" };
    } else if (kind === "url") {
      prop = { id, name, type: "url" };
    } else if (kind === "relation") {
      prop = { id, name, type: "text" };
      notes.push({ reason: `relation « ${name} » convertie en texte et en liens`, count: 1 });
    } else if (kind === "multiselect" || kind === "select") {
      options = makeOptions(distinct(filled.flatMap(kind === "multiselect" ? splitMulti : (value) => [value])), ctx.makeId);
      prop = { id, name, type: kind, options };
    } else {
      prop = { id, name, type: "text" };
    }
    properties.push(prop);
    if (kind === "date") {
      if (filled.some((value) => /→|->/.test(value))) {
        notes.push({ reason: `plage de dates « ${name} » réduite à son début`, count: 1 });
      }
      if (filled.some((value) => /\d{1,2}[:h]\d{2}/.test(value))) {
        notes.push({ reason: `heure ignorée dans « ${name} »`, count: 1 });
      }
      if (filled.some((value) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value))) {
        notes.push({ reason: `dates de « ${name} » lues au format jour/mois/année`, count: 1 });
      }
    }

    table.rows.forEach((row, index) => {
      const raw = (row[column] ?? "").trim();
      if (raw === "") return;
      let value: Value | undefined;
      if (kind === "checkbox") {
        value = TRUTHY.has(fold(raw)) ? true : undefined;
      } else if (kind === "date") {
        const start = parseNotionDate(raw);
        value = start ?? undefined;
        // Une plage perd sa fin dans une valeur de type Date : le corps la garde.
        if (start && /→|->/.test(raw)) extras[index].push(`**${name}** : ${raw}`);
      } else if (kind === "url") {
        value = raw.slice(0, LIMITS.url);
      } else if (kind === "relation") {
        const links = splitUrls(raw);
        if (links.length > 0) {
          const labelled = links.map((url) => {
            const title = ctx.resolveLink(url)?.title ?? url;
            return `[${title.replace(/[[\]]/g, "")}](${url})`;
          });
          extras[index].push(`**${name}** : ${labelled.join(" · ")}`);
          value = links
            .map((url) => ctx.resolveLink(url)?.title ?? url)
            .join(", ")
            .slice(0, LIMITS.text);
        }
      } else if (kind === "select") {
        value = options.find((option) => fold(option.name) === fold(raw))?.id;
      } else if (kind === "multiselect") {
        const ids = splitMulti(raw)
          .map((part) => options.find((option) => fold(option.name) === fold(part))?.id)
          .filter((optionId): optionId is string => optionId !== undefined);
        value = ids.length > 0 ? [...new Set(ids)] : undefined;
      } else {
        value = raw.slice(0, LIMITS.text);
        if (raw.length > LIMITS.text) notes.push({ reason: `texte tronqué à ${LIMITS.text} caractères`, count: 1 });
      }
      if (value !== undefined) rowValues[index][id] = value;
    });
  }

  const entries: CsvEntry[] = table.rows.map((row, index) => {
    const title = (row[0] ?? "").trim().slice(0, 200) || "Sans titre";
    return { title, values: rowValues[index], extraMarkdown: extras[index].join("\n\n") };
  });

  const config: DbConfig = {
    properties,
    view: sanitizeView({ kind: "table" }, properties),
  };
  return { config, entries, notes, ignored };
}
