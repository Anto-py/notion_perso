import { describe, expect, it } from "vitest";
import { keyFromIndex } from "@/lib/order_key";
import {
  checkValue,
  countLosses,
  filterOpsFor,
  isDateProp,
  isNumberProp,
  isTwin,
  matchesFilters,
  normalizeValue,
  rollupResultType,
  sortEntries,
  transferValues,
  validateProperties,
  valuesToText,
  type EntryRow,
  type LinkRef,
  type Property,
  type Value,
  type Values,
} from "@/lib/properties";
import { computeRollup, mergeTwins, relationDelta, targetFits, twinProperty, withLink } from "@/lib/relation";

// Relations entre bases (étape 10, palier a) : ce qui se décide sans base,
// c'est-à-dire la forme de la valeur, sa conversion et sa lecture dans une vue.

const ressources: Property = {
  id: "prop_ressources",
  name: "Ressources",
  type: "relation",
  target: "db_veille",
  single: false,
  reciprocal: false,
};
const tutrice: Property = { ...ressources, id: "prop_tutrice", name: "Tutrice", single: true };
const sequences: Property = { ...ressources, id: "prop_sequences", name: "Séquences", target: "db_sequences" };

let order = 0;
const entry = (title: string, values: Values, links?: Record<string, LinkRef[]>): EntryRow => ({
  id: title,
  title,
  icon: null,
  values,
  manualOrder: keyFromIndex(order++),
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  links,
});

const ref = (id: string, title: string): LinkRef => ({ id, title, icon: null, trashed: false, publicBaseId: null });

describe("validateProperties, relation", () => {
  it("accepte une relation qui désigne sa base cible et normalise ses cases", () => {
    expect(validateProperties([ressources])).toEqual([ressources]);
    expect(validateProperties([{ id: "prop_x", name: "Liens", type: "relation", target: "db_autre" }])).toEqual([
      { id: "prop_x", name: "Liens", type: "relation", target: "db_autre", single: false, reciprocal: false },
    ]);
  });

  it("refuse une relation sans base cible ou avec une cible mal formée", () => {
    expect(validateProperties([{ id: "prop_x", name: "Liens", type: "relation" }])).toMatch(/base cible/);
    expect(validateProperties([{ id: "prop_x", name: "Liens", type: "relation", target: "pas un id" }])).toMatch(/base cible/);
  });

  it("n'attache pas d'options à une relation", () => {
    const result = validateProperties([{ ...ressources, options: [{ id: "o1", name: "A", color: "blue" }] }]);
    expect(result).toEqual([ressources]);
  });
});

describe("valeur d'une relation", () => {
  it("garde l'ordre d'ajout, écarte les doublons et les identifiants mal formés", () => {
    expect(normalizeValue(ressources, ["pg_b", "pg_a", "pg_b", 3, "pas un id"])).toEqual(["pg_b", "pg_a"]);
    expect(normalizeValue(ressources, [])).toBeUndefined();
    expect(normalizeValue(ressources, "pg_a")).toBeUndefined();
  });

  it("« une seule entrée » ne retient que la première", () => {
    expect(normalizeValue(tutrice, ["pg_a", "pg_b"])).toEqual(["pg_a"]);
  });

  it("checkValue refuse une liste pour une relation limitée à une entrée", () => {
    expect(checkValue(ressources, ["pg_a", "pg_b"])).toBeNull();
    expect(checkValue(tutrice, ["pg_a", "pg_b"])).toMatch(/entrées liées/);
    expect(checkValue(ressources, "pg_a")).toMatch(/entrées liées/);
  });

  it("les identifiants n'entrent pas dans values_text : ni recherche ni conversion", () => {
    expect(valuesToText([ressources], { prop_ressources: ["pg_a", "pg_b"] })).toBe("");
  });
});

describe("transferValues, relation", () => {
  it("ne suit que vers une relation de même nom ET de même base cible", () => {
    const values: Values = { prop_ressources: ["pg_a"] };
    expect(transferValues([ressources], [{ ...ressources, id: "prop_r2" }], values)).toEqual({ prop_r2: ["pg_a"] });
    expect(transferValues([ressources], [{ ...sequences, id: "prop_r2", name: "Ressources" }], values)).toEqual({});
  });
});

describe("vues, relation", () => {
  it("« contient » porte l'id d'une entrée, « est vide » la liste absente", () => {
    const a = entry("A", { prop_ressources: ["pg_a", "pg_b"] }, { prop_ressources: [ref("pg_a", "Horta"), ref("pg_b", "Van de Velde")] });
    const b = entry("B", {});
    const filters = [{ prop: "prop_ressources", op: "contains" as const, value: "pg_a" }];
    expect(matchesFilters(a, filters, [ressources])).toBe(true);
    expect(matchesFilters(b, filters, [ressources])).toBe(false);
    expect(matchesFilters(b, [{ prop: "prop_ressources", op: "is_empty" }], [ressources])).toBe(true);
  });

  it("se trie par le titre de sa première puce, sans casse ni accents", () => {
    const a = entry("A", { prop_ressources: ["pg_c"] }, { prop_ressources: [ref("pg_c", "école")] });
    const b = entry("B", { prop_ressources: ["pg_d"] }, { prop_ressources: [ref("pg_d", "Fabrique")] });
    const c = entry("C", {});
    const sorted = sortEntries([b, c, a], [{ prop: "prop_ressources", dir: "asc" }], [ressources]);
    expect(sorted.map((item) => item.id)).toEqual(["A", "B", "C"]);
  });
});

describe("jumelle d'une relation réciproque", () => {
  const declaring: Property = { ...ressources, reciprocal: true };
  const other: Property = { id: "prop_titre", name: "Titre court", type: "text" };

  it("naît dans la base cible avec la cible de la déclarante et un nom suivi", () => {
    const twin = mergeTwins([other], "db_sequences", [declaring]).at(-1)!;
    expect(twin).toEqual({
      id: expect.stringMatching(/^prop_/),
      name: "Ressources",
      type: "relation",
      target: "db_sequences",
      single: false,
      twinOf: { db: "db_sequences", prop: "prop_ressources" },
    });
    expect(isTwin(twin)).toBe(true);
  });

  it("garde son id et sa place quand la déclarante est renommée", () => {
    const first = mergeTwins([other], "db_sequences", [declaring]).at(-1)!;
    const second = mergeTwins([other, first], "db_sequences", [{ ...declaring, name: "Sources" }]).at(-1)!;
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Sources");
  });

  it("prend un nom suffixé quand la base cible porte déjà ce nom", () => {
    const taken: Property = { id: "prop_r", name: "Ressources", type: "text" };
    const twin = mergeTwins([taken], "db_sequences", [declaring]).at(-1)!;
    expect(twin.name).toBe("Ressources 2");
  });

  it("disparaît quand la relation perd sa réciprocité ou sa cible", () => {
    const twin = mergeTwins([other], "db_sequences", [declaring]).at(-1)!;
    expect(mergeTwins([other, twin], "db_sequences", [{ ...declaring, reciprocal: false }])).toEqual([other]);
    expect(mergeTwins([other, twin], "db_sequences", [])).toEqual([other]);
  });

  it("laisse intactes les jumelles d'une autre base déclarante", () => {
    const mine = mergeTwins([other], "db_sequences", [declaring]).at(-1)!;
    const foreign: Property = { ...twinProperty({ ...declaring, id: "prop_x" }, "db_autre", []), id: "prop_foreign" };
    const merged = mergeTwins([other, mine, foreign], "db_sequences", [{ ...declaring, reciprocal: false }]);
    expect(merged.map((prop) => prop.id)).toEqual([other.id, foreign.id]);
  });

  it("suit la relation vers soi-même sans se perdre", () => {
    const self: Property = { ...declaring, target: "db_sequences" };
    const twin = mergeTwins([other], "db_sequences", [self]).at(-1)!;
    const merged = mergeTwins([other, twin], "db_sequences", [self]);
    expect(merged.filter((prop) => prop.twinOf)).toEqual([twin]);
  });

  it("validateProperties accepte un twinOf bien formé et ignore un twinOf abîmé", () => {
    const twin = { id: "prop_j", name: "Jumelle", type: "relation", target: "db_sequences", twinOf: { db: "db_sequences", prop: "prop_ressources" } };
    expect(validateProperties([twin])).toEqual([{ ...twin, single: false, reciprocal: false }]);
    expect(validateProperties([{ ...twin, twinOf: { db: "pas un id", prop: "prop_ressources" } }])).toEqual([
      { id: "prop_j", name: "Jumelle", type: "relation", target: "db_sequences", single: false, reciprocal: false },
    ]);
  });

  it("refuse d'écrire la valeur d'une jumelle", () => {
    const [twin] = mergeTwins([], "db_sequences", [declaring]);
    expect(checkValue(twin, ["pg_a"])).toMatch(/calculée/);
  });

  it("ne perd rien quand on supprime une jumelle et ne la reporte pas", () => {
    const [twin] = mergeTwins([], "db_sequences", [declaring]);
    expect(countLosses([twin], [], [{ [twin.id]: ["pg_a"] }])).toBe(0);
    const values: Values = { prop_ressources: ["pg_a"] };
    expect(transferValues([twin], [{ ...twin, id: "prop_r2" }], values)).toEqual({});
  });
});

describe("relationDelta et withLink", () => {
  it("sépare ce qui s'ajoute de ce qui se retire", () => {
    expect(relationDelta(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(relationDelta([], ["c"])).toEqual({ add: ["c"], remove: [] });
  });

  it("ajoute en fin et remplace la valeur d'une relation à une seule entrée", () => {
    expect(withLink(ressources, ["a"], "b", true)).toEqual(["a", "b"]);
    expect(withLink(ressources, ["a"], "a", true)).toEqual(["a"]);
    expect(withLink(ressources, ["a", "b"], "a", false)).toEqual(["b"]);
    expect(withLink(tutrice, ["a"], "b", true)).toEqual(["b"]);
  });
});

describe("countLosses, relation", () => {
  it("compte les entrées qui perdraient une puce en passant à « une seule entrée »", () => {
    const after = { ...ressources, single: true };
    expect(countLosses([ressources], [after], [{ prop_ressources: ["pg_a", "pg_b"] }, { prop_ressources: ["pg_a"] }])).toBe(1);
  });

  it("compte la perte de toutes les puces quand la base cible change", () => {
    const after = { ...ressources, target: "db_autre" };
    expect(countLosses([ressources], [after], [{ prop_ressources: ["pg_a"] }, {}])).toBe(1);
  });
});

// Cumul (étape 10, palier c) : un calcul à travers une relation, sans valeur
// stockée. Ce qui se décide sans base est ici.
describe("cumul", () => {
  const compte: Property = {
    id: "prop_nb",
    name: "Ressources comptées",
    type: "rollup",
    relation: "prop_ressources",
    target: "prop_titre",
    calc: "count",
    format: "number",
  };
  const source = (...values: (Value | undefined)[]) => values.map((value) => ({ value }));
  const numberTarget: Property = { id: "prop_note", name: "Note", type: "number" };
  const dateTarget: Property = { id: "prop_date", name: "Date", type: "date" };

  it("validateProperties accepte un cumul, normalise calcul et format, tolère l'inachevé", () => {
    expect(validateProperties([ressources, compte])).toEqual([ressources, compte]);
    expect(validateProperties([ressources, { ...compte, calc: "bogus" }])).toEqual([ressources, compte]);
    expect(validateProperties([{ id: "prop_x", name: "Cumul", type: "rollup" }])).toEqual([
      { id: "prop_x", name: "Cumul", type: "rollup", calc: "count", format: "number" },
    ]);
  });

  it("refuse une relation à traverser absente, d'un autre type ou jumelle", () => {
    expect(validateProperties([ressources, { ...compte, relation: "prop_inconnue" }])).toMatch(/relation à traverser/);
    expect(validateProperties([{ id: "prop_texte", name: "T", type: "text" }, { ...compte, relation: "prop_texte" }])).toMatch(
      /relation à traverser/,
    );
    const [twin] = mergeTwins([], "db_veille", [{ ...ressources, reciprocal: true }]);
    expect(validateProperties([twin, { ...compte, relation: twin.id }])).toMatch(/relation à traverser/);
  });

  it("ne stocke aucune valeur : lecture calculée seulement, écriture refusée", () => {
    expect(normalizeValue(compte, 4)).toBe(4);
    expect(normalizeValue(compte, "4")).toBeUndefined();
    expect(checkValue(compte, 4)).toMatch(/calculée/);
    expect(valuesToText([compte], { prop_nb: 4 })).toBe("");
    const dates = { ...compte, calc: "newest" as const };
    expect(normalizeValue(dates, "2026-10-01")).toBe("2026-10-01");
    expect(normalizeValue(dates, 3)).toBeUndefined();
  });

  it("un cumul ne se reporte pas et sa suppression ne perd rien", () => {
    expect(transferValues([compte], [{ ...compte, id: "prop_n2" }], { prop_nb: 4 })).toEqual({});
    expect(countLosses([compte], [], [{ prop_nb: 4 }])).toBe(0);
  });

  it("compte les entrées liées et les valeurs remplies", () => {
    expect(computeRollup("count", null, source(1, undefined, 3))).toBe(3);
    expect(computeRollup("count", null, [])).toBe(0);
    expect(computeRollup("count_filled", numberTarget, source(1, undefined, 3))).toBe(2);
    expect(computeRollup("percent", numberTarget, source(1, undefined, 3))).toBe(66.7);
    expect(computeRollup("percent", numberTarget, [])).toBeNull();
  });

  it("somme, moyenne et extrêmes sur un Nombre ; somme vide à zéro, les autres vides", () => {
    expect(computeRollup("sum", numberTarget, source(1, undefined, 3))).toBe(4);
    expect(computeRollup("sum", numberTarget, [])).toBe(0);
    expect(computeRollup("avg", numberTarget, source(1, undefined, 3))).toBe(2);
    expect(computeRollup("avg", numberTarget, [])).toBeNull();
    expect(computeRollup("min", numberTarget, source(4, 2, 8))).toBe(2);
    expect(computeRollup("max", numberTarget, source(4, 2, 8))).toBe(8);
  });

  it("la plus ancienne et la plus récente sur une Date", () => {
    expect(computeRollup("oldest", dateTarget, source("2026-10-03", "2026-09-01"))).toBe("2026-09-01");
    expect(computeRollup("newest", dateTarget, source("2026-10-03", "2026-09-01"))).toBe("2026-10-03");
    expect(computeRollup("oldest", dateTarget, [])).toBeNull();
  });

  it("une cible absente ou d'un type étranger au calcul rend null", () => {
    expect(computeRollup("sum", null, source(1))).toBeNull();
    expect(computeRollup("sum", dateTarget, source("2026-10-03"))).toBeNull();
    expect(computeRollup("oldest", numberTarget, source(1))).toBeNull();
    expect(targetFits("count", null)).toBe(true);
    expect(targetFits("count_filled", null)).toBe(false);
    expect(targetFits("sum", numberTarget)).toBe(true);
    expect(targetFits("sum", dateTarget)).toBe(false);
    expect(targetFits("oldest", dateTarget)).toBe(true);
  });

  it("emprunte au type de son résultat ses filtres et son type de valeur", () => {
    expect(rollupResultType("sum")).toBe("number");
    expect(rollupResultType("newest")).toBe("date");
    expect(filterOpsFor(compte)).toEqual(["eq", "neq", "gt", "lt", "is_empty", "is_not_empty"]);
    expect(filterOpsFor({ ...compte, calc: "oldest" })).toEqual(["is", "before", "after", "is_empty", "is_not_empty"]);
    expect(isNumberProp(compte)).toBe(true);
    expect(isDateProp({ ...compte, calc: "oldest" })).toBe(true);
    expect(isNumberProp({ ...compte, calc: "oldest" })).toBe(false);
  });

  it("se trie et se filtre comme un nombre", () => {
    const a = entry("A", { prop_nb: 2 });
    const b = entry("B", { prop_nb: 10 });
    const c = entry("C", {});
    expect(sortEntries([b, c, a], [{ prop: "prop_nb", dir: "asc" }], [compte]).map((item) => item.id)).toEqual(["A", "B", "C"]);
    expect(matchesFilters(a, [{ prop: "prop_nb", op: "gt", value: "1" }], [compte])).toBe(true);
    expect(matchesFilters(c, [{ prop: "prop_nb", op: "is_empty" }], [compte])).toBe(true);
  });
});
