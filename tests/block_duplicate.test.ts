import { describe, expect, it } from "vitest";
import { duplicateBlocks, type DupBlock } from "@/lib/block_duplicate";

// Générateur prévisible : n1, n2, n3… Le navigateur y branche crypto.randomUUID.
function counter() {
  let n = 0;
  return () => `n${++n}`;
}

const text = (value: string) => [{ type: "text", text: value, styles: {} }];
const para = (id: string, value: string, children: DupBlock[] = []): DupBlock => ({
  id,
  type: "paragraph",
  props: {},
  content: text(value),
  children,
});
const owner = (id: string, pageId: string, kind = "page"): DupBlock => ({ id, type: "subpage", props: { pageId, kind, link: false }, children: [] });

// Tous les identifiants d'une forêt de blocs, à toute profondeur.
function idsOf(blocks: readonly DupBlock[]): string[] {
  return blocks.flatMap((block) => [block.id as string, ...idsOf(block.children ?? [])]);
}

describe("duplicateBlocks", () => {
  it("copie un paragraphe : contenu et props identiques, identifiant neuf", () => {
    const [copy] = duplicateBlocks([para("a", "bonjour")], counter());
    expect(copy.id).toBe("n1");
    expect(copy.type).toBe("paragraph");
    expect(copy.content).toEqual(text("bonjour"));
    expect(copy.props).toEqual({});
  });

  it("ne partage aucune référence avec l'original", () => {
    const original = para("a", "bonjour");
    const [copy] = duplicateBlocks([original], counter());
    (copy.content as { text: string }[])[0].text = "modifié";
    (copy.props as Record<string, unknown>).textColor = "red";
    expect((original.content as { text: string }[])[0].text).toBe("bonjour");
    expect(original.props).toEqual({});
    expect(original.id).toBe("a");
  });

  it("donne des identifiants uniques à toute profondeur, sans en reprendre à l'original", () => {
    const tree = [para("a", "racine", [para("b", "fils", [para("c", "petit-fils")]), para("d", "autre fils")]), para("e", "sœur")];
    const copy = duplicateBlocks(tree, counter());
    const copyIds = idsOf(copy);
    expect(copyIds).toHaveLength(5);
    expect(new Set(copyIds).size).toBe(5);
    expect(copyIds.some((id) => idsOf(tree).includes(id))).toBe(false);
  });

  it("garde l'arborescence et l'ordre des enfants", () => {
    const tree = [para("a", "racine", [para("b", "un"), para("c", "deux"), para("d", "trois")])];
    const [copy] = duplicateBlocks(tree, counter());
    expect((copy.children ?? []).map((child) => (child.content as { text: string }[])[0].text)).toEqual(["un", "deux", "trois"]);
  });

  it("renouvelle aussi les identifiants des colonnes", () => {
    const columns: DupBlock = {
      id: "cl",
      type: "columnList",
      props: {},
      children: [
        { id: "c1", type: "column", props: { width: 1 }, children: [para("p1", "gauche")] },
        { id: "c2", type: "column", props: { width: 1 }, children: [para("p2", "droite")] },
      ],
    };
    const [copy] = duplicateBlocks([columns], counter());
    expect(new Set(idsOf([copy])).size).toBe(5);
    expect(idsOf([copy])).not.toContain("c1");
    expect(copy.children?.[0].props).toEqual({ width: 1 });
  });

  it("copie un tableau sans en partager les lignes", () => {
    const table: DupBlock = {
      id: "t",
      type: "table",
      props: {},
      content: { type: "tableContent", headerRows: 1, rows: [{ cells: [text("A"), text("B")] }, { cells: [text("1"), text("2")] }] },
      children: [],
    };
    const [copy] = duplicateBlocks([table], counter());
    expect(copy.content).toEqual(table.content);
    expect(copy.content).not.toBe(table.content);
    expect((copy.content as { rows: unknown[] }).rows).not.toBe((table.content as { rows: unknown[] }).rows);
  });

  it("garde l'adresse d'une image : le média est partagé, le nettoyage lit les citations", () => {
    const image: DupBlock = { id: "i", type: "image", props: { url: "/api/media/up_0123456789abcdef.png", caption: "vue" }, children: [] };
    const [copy] = duplicateBlocks([image], counter());
    expect(copy.props).toEqual({ url: "/api/media/up_0123456789abcdef.png", caption: "vue" });
  });

  it("fait d'une sous-page propriétaire un lien, pour que supprimer la copie ne jette pas la page", () => {
    const [copy] = duplicateBlocks([owner("s", "pg_a")], counter());
    expect(copy.props).toEqual({ pageId: "pg_a", kind: "page", link: true });
  });

  it("fait aussi du bloc d'une base un lien", () => {
    const [copy] = duplicateBlocks([owner("s", "pg_base", "database")], counter());
    expect(copy.props).toEqual({ pageId: "pg_base", kind: "database", link: true });
  });

  it("traite une sous-page cachée dans les enfants ou une colonne", () => {
    const tree: DupBlock[] = [
      para("a", "dépliant", [owner("s1", "pg_a")]),
      { id: "cl", type: "columnList", props: {}, children: [{ id: "c", type: "column", props: {}, children: [owner("s2", "pg_b")] }] },
    ];
    const copy = duplicateBlocks(tree, counter());
    const nested = copy[0].children?.[0].props as { link: boolean };
    const inColumn = copy[1].children?.[0].children?.[0].props as { link: boolean };
    expect(nested.link).toBe(true);
    expect(inColumn.link).toBe(true);
  });

  it("laisse un lien tel quel et n'altère pas la sous-page de l'original", () => {
    const source = owner("s", "pg_a");
    const link: DupBlock = { id: "l", type: "subpage", props: { pageId: "pg_b", kind: "page", link: true }, children: [] };
    const copy = duplicateBlocks([source, link], counter());
    expect(copy[1].props).toEqual({ pageId: "pg_b", kind: "page", link: true });
    expect(source.props).toEqual({ pageId: "pg_a", kind: "page", link: false });
  });

  it("ne change pas les props d'un autre bloc qui porterait un champ link", () => {
    const other: DupBlock = { id: "x", type: "bookmark", props: { url: "https://ex.be", link: false }, children: [] };
    const [copy] = duplicateBlocks([other], counter());
    expect(copy.props).toEqual({ url: "https://ex.be", link: false });
  });

  it("tolère l'absence d'enfants, de contenu et de props", () => {
    const [copy] = duplicateBlocks([{ id: "d", type: "divider" }], counter());
    expect(copy.type).toBe("divider");
    expect(copy.id).toBe("n1");
    expect(copy.children).toEqual([]);
  });

  it("garde l'ordre des blocs frères et rend une liste vide pour une liste vide", () => {
    const copy = duplicateBlocks([para("a", "un"), para("b", "deux")], counter());
    expect(copy.map((block) => (block.content as { text: string }[])[0].text)).toEqual(["un", "deux"]);
    expect(duplicateBlocks([], counter())).toEqual([]);
  });

  it("n'appelle le générateur qu'une fois par bloc", () => {
    let calls = 0;
    duplicateBlocks([para("a", "x", [para("b", "y")])], () => `n${++calls}`);
    expect(calls).toBe(2);
  });
});
