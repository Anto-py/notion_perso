import { describe, expect, it } from "vitest";
import { ancestorsOf, buildTree, linkChoices, wouldCreateCycle, type TreeRow } from "@/lib/tree";

const row = (id: string, parentId: string | null): TreeRow => ({ id, parentId, type: "page", title: id, icon: null, closed: false });

// a ─ b ─ c, et d à la racine
const parentOf = new Map<string, string | null>([
  ["a", null],
  ["b", "a"],
  ["c", "b"],
  ["d", null],
]);

describe("buildTree", () => {
  it("imbrique les enfants sous leur parent en gardant l'ordre reçu", () => {
    const tree = buildTree([row("a", null), row("b", "a"), row("c", "a"), row("d", null)]);
    expect(tree.map((n) => n.id)).toEqual(["a", "d"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("remonte à la racine une page dont le parent est absent", () => {
    const tree = buildTree([row("b", "parti")]);
    expect(tree.map((n) => n.id)).toEqual(["b"]);
  });
});

describe("wouldCreateCycle", () => {
  it("refuse de placer une page sous elle-même", () => {
    expect(wouldCreateCycle(parentOf, "a", "a")).toBe(true);
  });

  it("refuse de placer une page sous sa descendante", () => {
    expect(wouldCreateCycle(parentOf, "a", "c")).toBe(true);
  });

  it("accepte un déplacement sans boucle, racine comprise", () => {
    expect(wouldCreateCycle(parentOf, "c", "d")).toBe(false);
    expect(wouldCreateCycle(parentOf, "c", null)).toBe(false);
    expect(wouldCreateCycle(parentOf, "d", "c")).toBe(false);
  });

  it("refuse plutôt que de tourner sans fin si la base contient déjà une boucle", () => {
    const loop = new Map<string, string | null>([["x", "y"], ["y", "x"], ["z", null]]);
    expect(wouldCreateCycle(loop, "z", "x")).toBe(true);
  });
});

describe("ancestorsOf", () => {
  it("liste les ancêtres du parent direct à la racine", () => {
    expect(ancestorsOf(parentOf, "c")).toEqual(["b", "a"]);
    expect(ancestorsOf(parentOf, "a")).toEqual([]);
  });
});

describe("linkChoices", () => {
  const titled = (id: string, parentId: string | null, title: string, type: TreeRow["type"] = "page"): TreeRow => ({
    id,
    parentId,
    type,
    title,
    icon: null,
    closed: false,
  });
  // Accueil ─ Bases ─ Veille (base), Accueil ─ Évaluation, Notes ─ Veille (page homonyme)
  const rows = [
    titled("acc", null, "Accueil"),
    titled("bases", "acc", "Bases"),
    titled("veille_db", "bases", "Veille", "database"),
    titled("eval", "acc", "Évaluation"),
    titled("notes", null, "Notes"),
    titled("veille_pg", "notes", "Veille"),
    titled("e1", "veille_db", "Entrée", "entry"),
    titled("vide", null, ""),
  ];

  it("suit l'ordre de la sidebar, chemin compris, sans la page hôte ni les entrées", () => {
    const choices = linkChoices(rows, "eval", "");
    expect(choices.map((choice) => choice.row.id)).toEqual(["acc", "bases", "veille_db", "notes", "veille_pg", "vide"]);
    expect(choices.find((choice) => choice.row.id === "veille_db")?.path).toEqual(["Accueil", "Bases"]);
    expect(choices[0].path).toEqual([]);
  });

  it("cherche par le titre sans casse ni accents, et départage deux homonymes par leur chemin", () => {
    expect(linkChoices(rows, "eval", "EVAL").map((choice) => choice.row.id)).toEqual([]);
    expect(linkChoices(rows, "notes", "evalu").map((choice) => choice.row.id)).toEqual(["eval"]);
    expect(linkChoices(rows, "acc", " veille ").map((choice) => choice.path)).toEqual([["Accueil", "Bases"], ["Notes"]]);
  });

  it("nomme « Sans titre » une page vide, recherche comprise", () => {
    expect(linkChoices(rows, "acc", "sans titre").map((choice) => choice.row.id)).toEqual(["vide"]);
  });
});
