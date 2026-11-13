import { describe, expect, it } from "vitest";
import { blockMoveError, blockTitle, carriedSubpages, isBlockList, soleSubpage, type MoveRow } from "@/lib/block_move";

const text = (value: string) => [{ type: "text", text: value, styles: {} }];
const para = (value: string, children: unknown[] = []) => ({
  id: `p-${value}`,
  type: "paragraph",
  props: {},
  content: text(value),
  children,
});
const sub = (pageId: string, link = false) => ({
  id: `b-${pageId}`,
  type: "subpage",
  props: { pageId, kind: "page", link },
  children: [],
});

function rowsOf(list: Array<Partial<MoveRow> & { id: string }>): Map<string, MoveRow> {
  return new Map(list.map((row) => [row.id, { parentId: null, type: "page", ...row }]));
}

describe("carriedSubpages", () => {
  const rows = rowsOf([
    { id: "src" },
    { id: "a", parentId: "src" },
    { id: "b", parentId: "src" },
    { id: "ailleurs", parentId: "autre" },
    { id: "base", parentId: "src", type: "database" },
  ]);

  it("rend les sous-pages propriétaires du bloc, enfants compris", () => {
    const block = para("titre", [para("x", [sub("b")]), sub("a")]);
    expect(carriedSubpages([block], "src", rows).sort()).toEqual(["a", "b"]);
  });

  it("ignore un lien, une page qui vit ailleurs, une base et une page inconnue", () => {
    const block = para("titre", [sub("a", true), sub("ailleurs"), sub("base"), sub("fantome")]);
    expect(carriedSubpages([block], "src", rows)).toEqual([]);
  });

  it("compte une page une seule fois, même citée deux fois", () => {
    expect(carriedSubpages([sub("a"), sub("a")], "src", rows)).toEqual(["a"]);
  });

  it("ne rend rien pour un bloc sans sous-page", () => {
    expect(carriedSubpages([para("rien")], "src", rows)).toEqual([]);
  });
});

describe("soleSubpage", () => {
  it("reconnaît un bloc qui n'est qu'une sous-page propriétaire emportée", () => {
    expect(soleSubpage([sub("a")], ["a"])).toBe("a");
  });

  it("refuse un lien, un bloc qui contient autre chose, plusieurs blocs", () => {
    expect(soleSubpage([sub("a", true)], ["a"])).toBeNull();
    expect(soleSubpage([para("x", [sub("a")])], ["a"])).toBeNull();
    expect(soleSubpage([sub("a"), sub("b")], ["a", "b"])).toBeNull();
  });

  it("refuse une sous-page que le bloc n'emporte pas (vit ailleurs)", () => {
    expect(soleSubpage([sub("a")], [])).toBeNull();
  });
});

describe("blockTitle", () => {
  it("prend le début du texte du bloc", () => {
    expect(blockTitle([para("Une idée à garder")])).toBe("Une idée à garder");
  });

  it("ne garde que la première ligne non vide, espaces ramenés à un", () => {
    const block = { type: "paragraph", content: text("  Une   idée \n  et la suite "), children: [] };
    expect(blockTitle([block])).toBe("Une idée");
  });

  it("descend dans les enfants quand le bloc lui-même n'a pas de texte", () => {
    const block = { type: "toggleListItem", content: [], children: [para("Dans l'enfant")] };
    expect(blockTitle([block])).toBe("Dans l'enfant");
  });

  it("rend une chaîne vide sans aucun texte (affichée « Sans titre »)", () => {
    expect(blockTitle([sub("a")])).toBe("");
    expect(blockTitle([{ type: "divider" }])).toBe("");
    expect(blockTitle([])).toBe("");
  });

  it("coupe à cent caractères avec une ellipse", () => {
    const title = blockTitle([para("a".repeat(150))]);
    expect(title).toBe(`${"a".repeat(100)}…`);
  });

  it("coupe par caractère entier, jamais au milieu d'un emoji", () => {
    const title = blockTitle([para("😀".repeat(150))]);
    expect(title).toBe(`${"😀".repeat(100)}…`);
  });

  it("garde un texte de cent caractères exactement, sans ellipse", () => {
    expect(blockTitle([para("b".repeat(100))])).toBe("b".repeat(100));
  });
});

describe("blockMoveError", () => {
  const rows = rowsOf([
    { id: "src" },
    { id: "a", parentId: "src" },
    { id: "a1", parentId: "a" },
    { id: "a2", parentId: "a1" },
    { id: "s", parentId: "src" },
    { id: "autre" },
    { id: "corbeille", trashed: true },
    { id: "dossier", type: "folder" },
    { id: "base", type: "database" },
    { id: "entree", type: "entry" },
    { id: "racine_bases", isBasesRoot: true },
  ]);
  const check = (targetId: string | null, carried: string[] = []) =>
    blockMoveError({ sourceId: "src", targetId, carried, rows });

  it("admet une page quelconque, la racine et une sœur non emportée", () => {
    expect(check("autre")).toBeNull();
    expect(check(null)).toBeNull();
    expect(check("s", ["a"])).toBeNull();
  });

  it("refuse la page courante", () => {
    expect(check("src")).toMatch(/déjà dans cette page/);
  });

  it("refuse une cible introuvable ou en corbeille", () => {
    expect(check("fantome")).toMatch(/introuvable|corbeille/);
    expect(check("corbeille")).toMatch(/introuvable|corbeille/);
  });

  it("refuse un dossier et une base", () => {
    expect(check("dossier")).toMatch(/dossier|base/);
    expect(check("base")).toMatch(/dossier|base/);
  });

  it("admet une entrée de base si le bloc n'emporte aucune sous-page", () => {
    expect(check("entree")).toBeNull();
  });

  it("refuse une entrée de base quand le bloc emporte une sous-page", () => {
    expect(check("entree", ["a"])).toMatch(/entrée/);
  });

  it("refuse l'entrée dans une sous-page emportée, ou dans l'une de ses descendantes", () => {
    expect(check("a", ["a"])).toMatch(/descendance/);
    expect(check("a1", ["a"])).toMatch(/descendance/);
    expect(check("a2", ["a"])).toMatch(/descendance/);
  });

  it("admet la descendance d'une sous-page que le bloc n'emporte pas", () => {
    expect(check("a1", [])).toBeNull();
    expect(check("a1", ["s"])).toBeNull();
  });

  it("refuse d'emporter la racine des bases", () => {
    expect(check("autre", ["racine_bases"])).toMatch(/Bases de données/);
  });

  it("la racine n'a pas de descendance à protéger", () => {
    expect(check(null, ["a"])).toBeNull();
  });
});

describe("isBlockList", () => {
  it("accepte un bloc de l'éditeur, enfants et tableau compris", () => {
    expect(isBlockList([para("x", [para("y"), sub("a")])])).toBe(true);
    expect(isBlockList([{ type: "table", content: { type: "tableContent", rows: [] } }])).toBe(true);
  });

  it("refuse ce qui n'est pas une liste de blocs", () => {
    expect(isBlockList(undefined)).toBe(false);
    expect(isBlockList("bloc")).toBe(false);
    expect(isBlockList({ type: "paragraph" })).toBe(false);
    expect(isBlockList([])).toBe(false);
  });

  it("refuse un bloc sans type, ou dont le type n'est pas un texte", () => {
    expect(isBlockList([{}])).toBe(false);
    expect(isBlockList([{ type: "" }])).toBe(false);
    expect(isBlockList([{ type: 3 }])).toBe(false);
    expect(isBlockList([null])).toBe(false);
    expect(isBlockList([["paragraph"]])).toBe(false);
  });

  it("refuse des props ou des enfants mal formés, à toute profondeur", () => {
    expect(isBlockList([{ type: "paragraph", props: "x" }])).toBe(false);
    expect(isBlockList([{ type: "paragraph", props: [] }])).toBe(false);
    expect(isBlockList([{ type: "paragraph", children: {} }])).toBe(false);
    expect(isBlockList([para("x", [{ type: 3 }])])).toBe(false);
  });

  it("refuse une imbrication démesurée", () => {
    let block: Record<string, unknown> = { type: "paragraph" };
    for (let i = 0; i < 40; i++) block = { type: "paragraph", children: [block] };
    expect(isBlockList([block])).toBe(false);
  });

  it("refuse plus de blocs que le menu n'en envoie", () => {
    expect(isBlockList(Array.from({ length: 51 }, () => ({ type: "paragraph" })))).toBe(false);
  });
});
