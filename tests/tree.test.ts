import { describe, expect, it } from "vitest";
import { ancestorsOf, buildTree, wouldCreateCycle, type TreeRow } from "@/lib/tree";

const row = (id: string, parentId: string | null): TreeRow => ({ id, parentId, type: "page", title: id, icon: null });

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
