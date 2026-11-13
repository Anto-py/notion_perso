import { describe, expect, it } from "vitest";
import { transformTargets } from "@/lib/block_transform";

const keys = (type: string, props?: Record<string, unknown>) => transformTargets(type, props).map((t) => t.key);

describe("transformTargets", () => {
  it("propose les mêmes cibles à tout bloc de texte, dans l'ordre du menu", () => {
    const all = [
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
      "toggleListItem",
      "quote",
      "codeBlock",
    ];
    for (const type of ["paragraph", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock"]) {
      expect(keys(type)).toEqual(all);
    }
    expect(keys("heading", { level: 2 })).toEqual(all);
  });

  it("coche le type actuel, un seul", () => {
    for (const type of ["paragraph", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock"]) {
      const current = transformTargets(type).filter((t) => t.current);
      expect(current.map((t) => t.type)).toEqual([type]);
    }
  });

  it("coche le titre du bon niveau", () => {
    expect(transformTargets("heading", { level: 1 }).filter((t) => t.current).map((t) => t.key)).toEqual(["heading-1"]);
    expect(transformTargets("heading", { level: 3 }).filter((t) => t.current).map((t) => t.key)).toEqual(["heading-3"]);
  });

  it("ne coche aucun titre pour un niveau hors du menu (4 à 6) ou sans niveau", () => {
    expect(transformTargets("heading", { level: 5 }).filter((t) => t.current)).toEqual([]);
    expect(transformTargets("heading").filter((t) => t.current)).toEqual([]);
  });

  it("les cibles d'un titre portent leur niveau, les autres types n'ont pas de props", () => {
    const byKey = Object.fromEntries(transformTargets("paragraph").map((t) => [t.key, t]));
    expect(byKey["heading-2"].type).toBe("heading");
    expect(byKey["heading-2"].props).toEqual({ level: 2 });
    expect(byKey["paragraph"].props).toBeUndefined();
    expect(byKey["quote"].props).toBeUndefined();
  });

  it("rend une liste vide pour un bloc qui n'est pas du texte", () => {
    for (const type of ["image", "file", "table", "divider", "youtube", "bookmark", "subpage", "linked", "columnList", "column", "conflict"]) {
      expect(transformTargets(type)).toEqual([]);
    }
  });

  it("rend une liste vide pour un type inconnu", () => {
    expect(transformTargets("inconnu")).toEqual([]);
    expect(transformTargets("")).toEqual([]);
  });

  it("chaque appel rend des objets neufs : en modifier un ne change pas le suivant", () => {
    const first = transformTargets("paragraph");
    first[0].label = "modifié";
    first[1].props!.level = 9;
    expect(transformTargets("paragraph")[0].label).not.toBe("modifié");
    expect(transformTargets("paragraph")[1].props).toEqual({ level: 1 });
  });
});
