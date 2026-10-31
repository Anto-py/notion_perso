import { describe, expect, it } from "vitest";
import { keyFromIndex } from "@/lib/order_key";
import {
  brusselsParts,
  changeType,
  checkValue,
  convertValue,
  countLosses,
  formatNumber,
  matchesFilters,
  normalizeValues,
  parseNumber,
  sanitizeFilter,
  sortEntries,
  transferValues,
  validateProperties,
  valuesToText,
  withTimes,
  type EntryRow,
  type Property,
  type Values,
} from "@/lib/properties";
import {
  calcOpsFor,
  calcText,
  computeCalc,
  duplicateView,
  LEGACY_VIEW_ID,
  newView,
  parseConfig,
  pickView,
  prefillValues,
  sanitizeView,
  sanitizeViews,
} from "@/lib/views";

const duree: Property = { id: "prop_duree", name: "Durée", type: "number", format: "number" };
const prix: Property = { id: "prop_prix", name: "Prix", type: "number", format: "euro" };
const cree: Property = { id: "prop_cree", name: "Créé le", type: "created_time" };
const modifie: Property = { id: "prop_modif", name: "Modifié le", type: "updated_time" };
const statut: Property = {
  id: "prop_statut",
  name: "Statut",
  type: "select",
  options: [
    { id: "s1", name: "À lire", color: "gray" },
    { id: "s2", name: "Traité", color: "green" },
  ],
};
const tags: Property = { id: "prop_tags", name: "Tags", type: "multiselect", options: [{ id: "t1", name: "IA", color: "blue" }] };
const lu: Property = { id: "prop_lu", name: "Lu", type: "checkbox" };
const note: Property = { id: "prop_note", name: "Note", type: "text" };
const all = [duree, prix, cree, modifie, statut, tags, lu, note];

let order = 0;
const entry = (title: string, values: Values, createdAt = "2026-10-01T10:00:00.000Z", updatedAt = createdAt): EntryRow => ({
  id: title,
  title,
  icon: null,
  values,
  manualOrder: keyFromIndex(order++),
  createdAt,
  updatedAt,
});

describe("nombres", () => {
  it("lit la saisie française comme anglaise", () => {
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1234.5")).toBe(1234.5);
    expect(parseNumber("3,50 €")).toBe(3.5);
    expect(parseNumber("12 %")).toBe(12);
    expect(parseNumber("-7")).toBe(-7);
    expect(parseNumber(",5")).toBe(0.5);
    expect(parseNumber("douze")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("1e20")).toBeNull();
  });

  it("écrit à la française selon le format", () => {
    expect(formatNumber(1234.5)).toBe("1 234,5");
    expect(formatNumber(1234.5, "euro")).toBe("1 234,50 €");
    expect(formatNumber(12, "percent")).toBe("12 %");
    expect(formatNumber(-1234567)).toBe("-1 234 567");
    expect(formatNumber(0.1 + 0.2)).toBe("0,3");
    expect(formatNumber(2 / 3, "number", 2)).toBe("0,67");
  });

  it("valide, convertit et indexe un Nombre", () => {
    expect(checkValue(duree, 12.5)).toBeNull();
    expect(checkValue(duree, "12")).toMatch(/nombre attendu/);
    expect(checkValue(duree, Number.NaN)).toMatch(/nombre attendu/);
    expect(convertValue(note, duree, "3,5")).toBe(3.5);
    expect(convertValue(note, duree, "beaucoup")).toBeUndefined();
    expect(convertValue(duree, note, 3.5)).toBe("3,5");
    expect(valuesToText([duree], { prop_duree: 1234.5 })).toBe("1234,5");
    expect(changeType(note, "number", [])).toEqual({ ...note, type: "number", format: "number" });
    expect(countLosses([note], [{ ...note, type: "number", format: "number" }], [{ prop_note: "12" }, { prop_note: "douze" }])).toBe(1);
  });

  it("garde le format à la validation, « number » à défaut", () => {
    const checked = validateProperties([
      { id: "a", name: "A", type: "number", format: "euro" },
      { id: "b", name: "B", type: "number", format: "dollar" },
      { id: "c", name: "C", type: "created_time" },
    ]);
    expect(checked).toEqual([
      { id: "a", name: "A", type: "number", format: "euro" },
      { id: "b", name: "B", type: "number", format: "number" },
      { id: "c", name: "C", type: "created_time" },
    ]);
  });

  it("filtre par =, ≠, >, <, vide, et trie numériquement, vides en dernier", () => {
    const rows = [entry("a", { prop_duree: 12 }), entry("b", { prop_duree: 3 }), entry("c", {}), entry("d", { prop_duree: 100 })];
    const titles = (filters: Parameters<typeof matchesFilters>[1]) =>
      rows.filter((row) => matchesFilters(row, filters, all)).map((row) => row.title);
    expect(titles([{ prop: duree.id, op: "gt", value: "10" }])).toEqual(["a", "d"]);
    expect(titles([{ prop: duree.id, op: "lt", value: "12,5" }])).toEqual(["a", "b"]);
    expect(titles([{ prop: duree.id, op: "eq", value: "3" }])).toEqual(["b"]);
    expect(titles([{ prop: duree.id, op: "neq", value: "3" }])).toEqual(["a", "c", "d"]);
    expect(titles([{ prop: duree.id, op: "is_empty" }])).toEqual(["c"]);
    expect(sortEntries(rows, [{ prop: duree.id, dir: "asc" }], all).map((row) => row.title)).toEqual(["b", "a", "d", "c"]);
    expect(sortEntries(rows, [{ prop: duree.id, dir: "desc" }], all).map((row) => row.title)).toEqual(["d", "a", "b", "c"]);
  });

  it("garde un filtre numérique en cours de frappe, inactif", () => {
    expect(sanitizeFilter({ prop: duree.id, op: "gt", value: "1,2," }, all)).toEqual({ prop: duree.id, op: "gt", value: "" });
    expect(sanitizeFilter({ prop: duree.id, op: "gt", value: "1," }, all)).toEqual({ prop: duree.id, op: "gt", value: "1," });
    expect(sanitizeFilter({ prop: duree.id, op: "gt", value: "10" }, all)).toEqual({ prop: duree.id, op: "gt", value: "10" });
    expect(sanitizeFilter({ prop: duree.id, op: "contains", value: "1" }, all)).toBeNull();
  });
});

describe("Créé le, Modifié le", () => {
  it("rend le jour et l'heure de Bruxelles, heure d'été comprise", () => {
    expect(brusselsParts("2026-10-31T22:30:00.000Z")).toEqual({ day: "2026-10-31", time: "23:30" });
    expect(brusselsParts("2026-07-14T22:30:00.000Z")).toEqual({ day: "2026-07-15", time: "00:30" });
    expect(brusselsParts("pas une date")).toBeNull();
  });

  it("ajoute les horodatages à la lecture, jamais à l'écriture", () => {
    const times = { createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" };
    expect(withTimes(all, { prop_duree: 1 }, times)).toEqual({ prop_duree: 1, prop_cree: times.createdAt, prop_modif: times.updatedAt });
    expect(withTimes([note], { prop_note: "x" }, times)).toEqual({ prop_note: "x" });
    expect(checkValue(cree, "2026-10-01T10:00:00.000Z")).toMatch(/lecture seule/);
    expect(valuesToText(all, withTimes(all, {}, times))).toBe("");
    expect(transferValues(all, all, withTimes(all, {}, times))).toEqual({});
    expect(normalizeValues([cree], { prop_cree: "n'importe quoi" })).toEqual({});
  });

  it("filtre au jour de Bruxelles et trie à l'heure exacte", () => {
    const rows = [
      // 23 h 30 UTC le 31 octobre : déjà le 1er novembre à Bruxelles (UTC+1).
      entry("tard", {}, "2026-10-31T23:30:00.000Z"),
      entry("tôt", {}, "2026-10-31T08:00:00.000Z"),
      entry("veille", {}, "2026-10-30T12:00:00.000Z", "2026-11-02T09:00:00.000Z"),
    ];
    const titles = (filters: Parameters<typeof matchesFilters>[1]) =>
      rows.filter((row) => matchesFilters(row, filters, all)).map((row) => row.title);
    expect(titles([{ prop: cree.id, op: "is", value: "2026-10-31" }])).toEqual(["tôt"]);
    expect(titles([{ prop: cree.id, op: "after", value: "2026-10-31" }])).toEqual(["tard"]);
    expect(titles([{ prop: modifie.id, op: "after", value: "2026-11-01" }])).toEqual(["veille"]);
    expect(sortEntries(rows, [{ prop: cree.id, dir: "desc" }], all).map((row) => row.title)).toEqual(["tard", "tôt", "veille"]);
  });
});

describe("vues", () => {
  it("relit l'ancienne vue unique comme une liste d'une vue, à l'identique", () => {
    const config = parseConfig({
      properties: [statut, note],
      view: { kind: "board", group_by: "prop_statut", filters: [{ prop: "prop_note", op: "is_empty" }], hidden: ["prop_note"] },
    });
    expect(config.views).toHaveLength(1);
    expect(config.views[0]).toMatchObject({
      id: LEGACY_VIEW_ID,
      name: "Kanban",
      kind: "board",
      group_by: "prop_statut",
      filters: [{ prop: "prop_note", op: "is_empty" }],
      hidden: ["prop_note"],
      calcs: {},
    });
    expect(parseConfig({}).views.map((view) => view.name)).toEqual(["Tableau"]);
  });

  it("écarte les ids en double ou invalides, plafonne à 20, n'est jamais vide", () => {
    expect(sanitizeViews([{ id: "v1" }, { id: "v1" }, { id: "pas valide !" }, { id: "v2", kind: "list" }], []).map((view) => view.id)).toEqual(["v1", "v2"]);
    expect(sanitizeViews(Array.from({ length: 30 }, (_, i) => ({ id: `v${i}` })), [])).toHaveLength(20);
    expect(sanitizeViews([], [])).toHaveLength(1);
    expect(sanitizeViews("n'importe quoi", [])).toHaveLength(1);
  });

  it("nomme, duplique et choisit les vues", () => {
    let n = 0;
    const makeId = (prefix: string) => `${prefix}_${n++}`;
    const first = sanitizeView({ id: "v_a", name: "Tout" }, all);
    const second = newView([first], "table", all, makeId);
    expect(second).toMatchObject({ id: "view_0", name: "Tableau", kind: "table", filters: [] });
    expect(newView([first, second], "table", all, makeId).name).toBe("Tableau 2");
    expect(newView([first], "board", all, makeId).group_by).toBe("prop_statut");
    const withFilter = { ...first, filters: [{ prop: statut.id, op: "is" as const, value: "s1" }] };
    const copy = duplicateView([withFilter], withFilter, makeId);
    expect(copy).toMatchObject({ name: "Tout (copie)", filters: withFilter.filters });
    expect(copy.id).not.toBe(first.id);
    expect(copy.filters).not.toBe(withFilter.filters);
    expect(pickView([first, second], "absente", second.id).id).toBe(second.id);
    expect(pickView([first, second], null, undefined).id).toBe(first.id);
  });

  it("retire d'une vue les calculs étrangers au type de la propriété", () => {
    const view = sanitizeView({ calcs: { prop_duree: "sum", prop_note: "sum", title: "count_all", prop_x: "count_all", prop_lu: "magie" } }, all);
    expect(view.calcs).toEqual({ prop_duree: "sum", title: "count_all" });
    expect(sanitizeView({ calcs: { prop_duree: "avg" } }, [{ ...duree, type: "text" }]).calcs).toEqual({});
    expect(calcOpsFor(note)).toEqual(["count_all", "count_filled", "count_empty"]);
    expect(calcOpsFor(duree)).toHaveLength(7);
  });

  it("préremplit ce que les filtres imposent sans ambiguïté", () => {
    const view = sanitizeView(
      {
        filters: [
          { prop: statut.id, op: "is", value: "s2" },
          { prop: statut.id, op: "is", value: "s1" },
          { prop: tags.id, op: "contains", value: "t1" },
          { prop: lu.id, op: "checked" },
          { prop: note.id, op: "contains", value: "x" },
          { prop: duree.id, op: "gt", value: "3" },
        ],
      },
      all,
    );
    expect(prefillValues(view, all)).toEqual({ prop_statut: "s2", prop_tags: ["t1"], prop_lu: true });
    expect(prefillValues(sanitizeView({ filters: [{ prop: statut.id, op: "is_not", value: "s1" }] }, all), all)).toEqual({});
  });
});

describe("calculs", () => {
  const rows = [entry("a", { prop_prix: 10, prop_note: "x" }), entry("b", { prop_prix: 2.5 }), entry("", {})];

  it("compte et calcule sur les entrées montrées", () => {
    expect(computeCalc(rows, note, "count_all")).toBe(3);
    expect(computeCalc(rows, note, "count_filled")).toBe(1);
    expect(computeCalc(rows, note, "count_empty")).toBe(2);
    expect(computeCalc(rows, { id: "title", name: "Titre", type: "text" }, "count_empty")).toBe(1);
    expect(computeCalc(rows, prix, "sum")).toBe(12.5);
    expect(computeCalc(rows, prix, "avg")).toBe(6.25);
    expect(computeCalc(rows, prix, "min")).toBe(2.5);
    expect(computeCalc(rows, prix, "max")).toBe(10);
    expect(computeCalc([], prix, "sum")).toBeNull();
    expect(computeCalc(rows, cree, "count_empty")).toBe(0);
  });

  it("écrit le résultat avec son libellé et le format de la propriété", () => {
    expect(calcText(prix, "sum", 12.5)).toBe("Somme 12,50 €");
    expect(calcText(duree, "avg", 2 / 3)).toBe("Moyenne 0,67");
    expect(calcText(note, "count_filled", 4)).toBe("Remplis 4");
    expect(calcText(prix, "max", null)).toBe("Max. —");
  });
});
