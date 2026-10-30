import { describe, expect, it } from "vitest";
import {
  changeType,
  convertValue,
  countLosses,
  groupEntries,
  matchesFilters,
  migrateValues,
  moveInOrder,
  nextColor,
  normalizeValue,
  checkValue,
  sanitizeView,
  sortEntries,
  uniqueName,
  validateProperties,
  valuesToText,
  type EntryRow,
  type Property,
  type Values,
} from "@/lib/properties";

const tags: Property = {
  id: "prop_tags",
  name: "Tags",
  type: "multiselect",
  options: [
    { id: "t1", name: "IA", color: "blue" },
    { id: "t2", name: "esprit critique", color: "green" },
    { id: "t3", name: "évaluation", color: "orange" },
  ],
};
const statut: Property = {
  id: "prop_statut",
  name: "Statut",
  type: "select",
  options: [
    { id: "s1", name: "À lire", color: "gray" },
    { id: "s2", name: "En cours", color: "yellow" },
    { id: "s3", name: "Traité", color: "green" },
  ],
};
const source: Property = { id: "prop_url", name: "Source", type: "url" };
const date: Property = { id: "prop_date", name: "Date d'ajout", type: "date" };
const lu: Property = { id: "prop_lu", name: "Lu", type: "checkbox" };
const note: Property = { id: "prop_note", name: "Note", type: "text" };
const veille = [source, tags, statut, date, lu, note];

let order = 0;
const entry = (title: string, values: Values, extra: Partial<EntryRow> = {}): EntryRow => ({
  id: title,
  title,
  icon: null,
  values,
  manualOrder: order++,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...extra,
});

describe("validateProperties", () => {
  it("accepte la base Veille et retire les options d'un type qui n'en a pas", () => {
    const result = validateProperties([...veille, { ...note, id: "prop_x", name: "Autre", options: tags.options }]);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Property[]).at(-1)).toEqual({ id: "prop_x", name: "Autre", type: "text" });
  });

  it("refuse deux propriétés de même nom, casse et accents compris, et le nom de la colonne Titre", () => {
    expect(validateProperties([note, { ...source, name: "NOTE" }])).toMatch(/déjà pris/);
    expect(validateProperties([{ ...note, name: "titre" }])).toMatch(/déjà pris/);
  });

  it("refuse un type inconnu, une couleur inconnue, une option en double", () => {
    expect(validateProperties([{ ...note, type: "formula" }])).toMatch(/Type/);
    expect(validateProperties([{ ...statut, options: [{ id: "o", name: "A", color: "fuchsia" }] }])).toMatch(/couleur/);
    expect(
      validateProperties([{ ...statut, options: [{ id: "a", name: "Fait", color: "gray" }, { id: "b", name: "fait", color: "red" }] }]),
    ).toMatch(/existe déjà/);
  });

  it("refuse un identifiant réservé aux colonnes fixes", () => {
    expect(validateProperties([{ ...note, id: "title" }])).toMatch(/Identifiant/);
  });
});

describe("sanitizeView", () => {
  it("retire ce qui pointe vers une propriété ou une option disparue, garde un filtre incomplet", () => {
    const view = sanitizeView(
      {
        kind: "table",
        filters: [
          { prop: "prop_disparue", op: "contains", value: "x" },
          { prop: "prop_statut", op: "is", value: "s_supprimee" },
          { prop: "prop_statut", op: "is", value: "" },
          { prop: "prop_tags", op: "is", value: "t1" },
          { prop: "title", op: "contains", value: "IA" },
        ],
        sorts: [{ prop: "prop_disparue", dir: "asc" }, { prop: "prop_date", dir: "desc" }, { prop: "prop_date", dir: "asc" }],
      },
      veille,
    );
    expect(view.filters).toEqual([
      { prop: "prop_statut", op: "is", value: "" },
      { prop: "title", op: "contains", value: "IA" },
    ]);
    expect(view.sorts).toEqual([{ prop: "prop_date", dir: "desc" }]);
  });

  it("groupe par défaut sur la première sélection, ou sur rien s'il n'y en a pas", () => {
    expect(sanitizeView({ kind: "board" }, veille).group_by).toBe("prop_statut");
    expect(sanitizeView({ kind: "board", group_by: "prop_tags" }, veille).group_by).toBe("prop_statut");
    expect(sanitizeView({ kind: "board" }, [note]).group_by).toBeNull();
  });
});

describe("valeurs", () => {
  it("lit une valeur valide, écarte une option inconnue ou une date impossible", () => {
    expect(normalizeValue(statut, "s2")).toBe("s2");
    expect(normalizeValue(statut, "s9")).toBeUndefined();
    expect(normalizeValue(tags, ["t1", "t9", "t1"])).toEqual(["t1"]);
    expect(normalizeValue(date, "2026-02-30")).toBeUndefined();
    expect(normalizeValue(lu, false)).toBeUndefined();
  });

  it("refuse à l'écriture une option inconnue plutôt que de l'effacer en silence", () => {
    expect(checkValue(statut, "s9")).toMatch(/option inconnue/);
    expect(checkValue(statut, "")).toBeNull();
    expect(checkValue(statut, null)).toBeNull();
    expect(checkValue(lu, "oui")).toMatch(/vrai ou faux/);
  });

  it("aplatit les valeurs en texte pour la recherche, noms d'options compris", () => {
    expect(valuesToText(veille, { prop_tags: ["t1", "t3"], prop_statut: "s1", prop_lu: true })).toBe("IA, évaluation À lire Oui");
  });
});

describe("conversion de type", () => {
  it("passe du texte à la sélection par le nom des options, casse ignorée", () => {
    const asSelect = changeType(note, "select", [{ prop_note: "Article" }, { prop_note: "vidéo" }, { prop_note: "article" }], (p) => `${p}_${order++}`);
    expect(asSelect.options?.map((o) => o.name)).toEqual(["Article", "vidéo"]);
    const converted = convertValue(note, asSelect, "ARTICLE");
    expect(converted).toBe(asSelect.options?.[0].id);
  });

  it("découpe un texte à virgules en plusieurs options", () => {
    const asTags = changeType(note, "multiselect", [{ prop_note: "IA, évaluation" }, { prop_note: "ia" }]);
    expect(asTags.options?.map((o) => o.name)).toEqual(["IA", "évaluation"]);
    expect(convertValue(note, asTags, "IA, évaluation")).toHaveLength(2);
  });

  it("garde les options entre sélection simple et multiple", () => {
    const multi = changeType(statut, "multiselect", []);
    expect(multi.options).toBe(statut.options);
    expect(convertValue(statut, multi, "s2")).toEqual(["s2"]);
    expect(convertValue(tags, { ...tags, type: "select" }, ["t2", "t1"])).toBe("t2");
  });

  it("convertit au mieux vers date, case à cocher et texte, et vide l'incompatible", () => {
    expect(convertValue(note, date, "2026-07-27")).toBe("2026-07-27");
    expect(convertValue(note, date, "27 juillet")).toBeUndefined();
    expect(convertValue(note, lu, "Oui")).toBe(true);
    expect(convertValue(note, lu, "peut-être")).toBeUndefined();
    expect(convertValue(tags, note, ["t1", "t2"])).toBe("IA, esprit critique");
  });

  it("emporte les valeurs d'une propriété supprimée", () => {
    expect(migrateValues(veille, [note], { prop_note: "garde", prop_statut: "s1" })).toEqual({ prop_note: "garde" });
  });
});

describe("countLosses", () => {
  const values: Values[] = [{ prop_statut: "s1" }, { prop_statut: "s2" }, { prop_tags: ["t1", "t3"] }, {}];

  it("compte les entrées vidées par la suppression d'une option utilisée", () => {
    const sansALire = { ...statut, options: statut.options!.slice(1) };
    expect(countLosses(veille, [source, tags, sansALire, date, lu, note], values)).toBe(1);
  });

  it("compte une sélection multiple amputée d'une option", () => {
    const sansEvaluation = { ...tags, options: tags.options!.slice(0, 2) };
    expect(countLosses([tags], [sansEvaluation], values)).toBe(1);
  });

  it("ne compte pas un renommage d'option", () => {
    const renomme = { ...statut, options: statut.options!.map((o) => ({ ...o, name: `${o.name} !` })) };
    expect(countLosses([statut], [renomme], values)).toBe(0);
  });

  it("compte la suppression d'une propriété remplie, pas celle d'une propriété vide", () => {
    expect(countLosses([statut, note], [note], values)).toBe(2);
    expect(countLosses([statut, note], [statut], values)).toBe(0);
  });

  it("ne compte rien quand le texte devient une sélection aux mêmes noms", () => {
    const textes: Values[] = [{ prop_note: "Article" }, { prop_note: "Vidéo" }];
    expect(countLosses([note], [changeType(note, "select", textes)], textes)).toBe(0);
    expect(countLosses([tags], [{ ...tags, type: "select" }], [{ prop_tags: ["t1", "t2"] }])).toBe(1);
  });
});

describe("filtres", () => {
  const rows = [
    entry("Une évaluation par l'IA", { prop_tags: ["t1", "t3"], prop_statut: "s1", prop_date: "2026-07-27" }),
    entry("Podcast esprit critique", { prop_tags: ["t2"], prop_lu: true }),
    entry("", { prop_statut: "s3" }),
  ];
  const keep = (filters: Parameters<typeof matchesFilters>[1]) =>
    rows.filter((row) => matchesFilters(row, filters, veille)).map((row) => row.id);

  it("cherche dans le titre sans tenir compte des accents ni de la casse", () => {
    expect(keep([{ prop: "title", op: "contains", value: "EVALUATION" }])).toEqual(["Une évaluation par l'IA"]);
  });

  it("filtre une sélection multiple par option, et combine les filtres par « et »", () => {
    expect(keep([{ prop: "prop_tags", op: "contains", value: "t1" }])).toEqual(["Une évaluation par l'IA"]);
    expect(keep([{ prop: "prop_tags", op: "not_contains", value: "t1" }])).toEqual(["Podcast esprit critique", ""]);
    expect(keep([{ prop: "prop_tags", op: "is_not_empty" }, { prop: "prop_lu", op: "checked" }])).toEqual(["Podcast esprit critique"]);
  });

  it("compte l'absence de valeur dans « n'est pas » et dans « non cochée »", () => {
    expect(keep([{ prop: "prop_statut", op: "is_not", value: "s1" }])).toEqual(["Podcast esprit critique", ""]);
    expect(keep([{ prop: "prop_lu", op: "unchecked" }])).toEqual(["Une évaluation par l'IA", ""]);
  });

  it("compare les dates et ignore un filtre sans valeur", () => {
    expect(keep([{ prop: "prop_date", op: "before", value: "2026-08-01" }])).toEqual(["Une évaluation par l'IA"]);
    expect(keep([{ prop: "prop_date", op: "after", value: "2026-08-01" }])).toEqual([]);
    expect(keep([{ prop: "prop_statut", op: "is", value: "" }])).toHaveLength(3);
  });
});

describe("sortEntries", () => {
  const a = entry("a", { prop_date: "2026-07-01", prop_statut: "s3" }, { manualOrder: 2 });
  const b = entry("b", { prop_date: "2026-09-01", prop_statut: "s1" }, { manualOrder: 1 });
  const c = entry("c", {}, { manualOrder: 0 });

  it("trie par date décroissante, valeurs vides en dernier", () => {
    expect(sortEntries([a, b, c], [{ prop: "prop_date", dir: "desc" }], veille).map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(sortEntries([a, b, c], [{ prop: "prop_date", dir: "asc" }], veille).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("trie une sélection dans l'ordre de ses options", () => {
    expect(sortEntries([a, b, c], [{ prop: "prop_statut", dir: "asc" }], veille).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("suit l'ordre manuel sans tri, et trie les titres en français", () => {
    expect(sortEntries([a, b, c], [], veille).map((e) => e.id)).toEqual(["c", "b", "a"]);
    const titres = ["Zèbre", "école", "Ecole 10", "Ecole 9"].map((t) => entry(t, {}));
    expect(sortEntries(titres, [{ prop: "title", dir: "asc" }], veille).map((e) => e.id)).toEqual(["école", "Ecole 9", "Ecole 10", "Zèbre"]);
  });
});

describe("groupEntries", () => {
  it("ouvre par « Sans statut », garde les colonnes vides et y range une option supprimée", () => {
    const columns = groupEntries([entry("x", { prop_statut: "s2" }), entry("y", {}), entry("z", { prop_statut: "s_partie" })], statut);
    expect(columns.map((c) => c.name)).toEqual(["Sans statut", "À lire", "En cours", "Traité"]);
    expect(columns.map((c) => c.entries.map((e) => e.id))).toEqual([["y", "z"], [], ["x"], []]);
  });
});

describe("moveInOrder", () => {
  const ids = ["a", "b", "c", "d"];

  it("place avant ou après une autre entrée", () => {
    expect(moveInOrder(ids, "d", { before: "b" })).toEqual(["a", "d", "b", "c"]);
    expect(moveInOrder(ids, "a", { after: "c" })).toEqual(["b", "c", "a", "d"]);
  });

  it("ne change rien si l'ancre est l'entrée elle-même ou inconnue", () => {
    expect(moveInOrder(ids, "b", { before: "b" })).toEqual(ids);
    expect(moveInOrder(ids, "b", { after: "zz" })).toEqual(ids);
  });
});

describe("noms et couleurs", () => {
  it("numérote un nom déjà pris", () => {
    expect(uniqueName([note], "Statut")).toBe("Statut");
    expect(uniqueName([statut, { ...note, name: "Statut 2" }], "statut")).toBe("statut 3");
  });

  it("choisit la couleur la moins employée", () => {
    expect(nextColor([])).toBe("gray");
    expect(nextColor(statut.options!)).toBe("brown");
  });
});
