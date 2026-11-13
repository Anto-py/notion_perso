import { describe, expect, it } from "vitest";
import { blockRefs, sharingWarnings } from "@/lib/block_move_share";
import type { ShareGraph, ShareNode } from "@/lib/publication";

const node = (id: string, extra: Partial<ShareNode> = {}): ShareNode => ({
  id,
  type: "page",
  parentId: null,
  dbId: null,
  closed: false,
  publicId: null,
  title: id,
  icon: null,
  links: [],
  opens: [],
  ...extra,
});
const graphOf = (...nodes: ShareNode[]): ShareGraph => new Map(nodes.map((n) => [n.id, n]));

const text = (value: string) => [{ type: "text", text: value, styles: {} }];
const para = (value: string, children: unknown[] = []) => ({ type: "paragraph", content: text(value), children });
const sub = (pageId: string, link = false) => ({ type: "subpage", props: { pageId, kind: "page", link }, children: [] });
const linked = (databaseId: string) => ({ type: "linked", props: { databaseId, embed: false }, children: [] });

// Source publiée « Source » (S) avec une sous-page « Sous A » (A) qui a deux
// sous-pages ; « Cible privée » (T) ; « Cible publiée » (P).
const base = () => [
  node("S", { title: "Source", publicId: "pub_S" }),
  node("A", { title: "Sous A", parentId: "S" }),
  node("A1", { parentId: "A" }),
  node("A2", { parentId: "A" }),
  node("T", { title: "Cible privée" }),
  node("P", { title: "Cible publiée", publicId: "pub_P" }),
];

const warn = (graph: ShareGraph, targetId: string | null, carried: string[], blocks: unknown[], sourceId = "S") =>
  sharingWarnings({ graph, sourceId, targetId, carried, blocks });

describe("blockRefs", () => {
  it("relève les sous-pages (propriétaires ou liens), les vues liées et les liens internes", () => {
    const block = para("x", [sub("a"), sub("b", true), linked("base1")]);
    const withLink = { type: "paragraph", content: [{ type: "link", href: "/page/pg_c", content: text("c") }], children: [block] };
    const refs = blockRefs([withLink]);
    expect(refs.links.sort()).toEqual(["a", "b", "base1", "pg_c"]);
    expect(refs.opens).toEqual(["base1"]);
  });

  it("écarte un id vide et une adresse extérieure", () => {
    const external = { type: "paragraph", content: [{ type: "link", href: "https://exemple.org", content: text("e") }] };
    expect(blockRefs([sub(""), external, linked("")])).toEqual({ links: [], opens: [] });
  });

  it("descend dans les cellules de tableau", () => {
    const table = {
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[{ type: "link", href: "/page/pg_t", content: text("t") }]] }] },
    };
    expect(blockRefs([table]).links).toEqual(["pg_t"]);
  });
});

describe("sharingWarnings", () => {
  it("ne dit rien quand aucune page n'est publiée", () => {
    const graph = graphOf(node("S"), node("A", { parentId: "S" }), node("T"));
    expect(warn(graph, "T", ["A"], [para("x", [sub("A")])])).toEqual([]);
  });

  it("ne dit rien quand tout reste dans la même publication", () => {
    const graph = graphOf(...base(), node("T2", { parentId: "S", title: "Sous-cible" }));
    expect(warn(graph, "T2", ["A"], [para("x", [sub("A")])])).toEqual([]);
  });

  it("prévient qu'une sous-page quitte une publication et que le bloc aussi", () => {
    const lines = warn(graphOf(...base()), "T", ["A"], [para("x", [sub("A")])]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/« Sous A » \(et ses 2 sous-pages\) ne sera plus lisible par le public/);
    expect(lines[0]).toMatch(/publication « Source »/);
    expect(lines[1]).toMatch(/contenu de ce bloc ne sera plus lisible/);
    expect(lines[1]).toMatch(/« Source »/);
  });

  it("prévient qu'une sous-page entre dans une publication, et nomme la cible", () => {
    const graph = graphOf(
      node("S", { title: "Source" }),
      node("A", { title: "Sous A", parentId: "S" }),
      node("A1", { parentId: "A" }),
      node("P", { title: "Cible publiée", publicId: "pub_P" }),
    );
    const lines = warn(graph, "P", ["A"], [para("x", [sub("A")])]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/« Sous A » \(et sa sous-page\) deviendra lisible par le public/);
    expect(lines[0]).toMatch(/« Cible publiée » est publiée/);
    expect(lines[1]).toMatch(/contenu de ce bloc deviendra lisible/);
  });

  it("nomme la publication quand la cible n'est publiée que par un ancêtre", () => {
    const graph = graphOf(node("S"), node("A", { parentId: "S" }), node("P", { title: "Racine pub", publicId: "pub_P" }), node("Q", { title: "Fille", parentId: "P" }));
    const lines = warn(graph, "Q", ["A"], [para("x", [sub("A")])]);
    expect(lines[0]).toMatch(/« Fille » est dans la publication « Racine pub »/);
  });

  it("un bloc sans sous-page ne signale que son contenu", () => {
    const priv = graphOf(node("S"), node("P", { title: "Cible publiée", publicId: "pub_P" }));
    expect(warn(priv, "P", [], [para("secret")])).toEqual([expect.stringMatching(/contenu de ce bloc deviendra lisible/)]);
    const pub = graphOf(node("S", { title: "Source", publicId: "pub_S" }), node("T"));
    expect(warn(pub, "T", [], [para("texte")])).toEqual([expect.stringMatching(/ne sera plus lisible/)]);
  });

  it("un bloc qui n'est que des sous-pages ne signale pas de contenu propre", () => {
    const lines = warn(graphOf(...base()), "T", ["A"], [sub("A")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/« Sous A »/);
  });

  it("une sous-page qui a sa propre publication reste publique", () => {
    const graph = graphOf(node("S", { publicId: "pub_S" }), node("A", { parentId: "S", publicId: "pub_A" }), node("T"));
    expect(warn(graph, "T", ["A"], [sub("A")])).toEqual([]);
  });

  it("une sous-page exclue reste privée, même rangée sous une page publiée", () => {
    const graph = graphOf(node("S"), node("A", { parentId: "S", closed: true }), node("P", { publicId: "pub_P" }));
    expect(warn(graph, "P", ["A"], [sub("A")])).toEqual([]);
  });

  it("un lien vers une page privée n'expose rien", () => {
    const graph = graphOf(node("S"), node("Q", { title: "Privée" }), node("P", { publicId: "pub_P", title: "Cible publiée" }));
    expect(warn(graph, "P", [], [sub("Q", true)])).toEqual([]);
  });

  it("vers la racine : une sous-page publique devient privée", () => {
    const lines = warn(graphOf(...base()), null, ["A"], [sub("A")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ne sera plus lisible/);
  });

  it("vers la racine : un bloc de texte d'une page publiée n'est plus lisible", () => {
    const lines = warn(graphOf(...base()), null, [], [para("idée")]);
    expect(lines).toEqual([expect.stringMatching(/contenu de ce bloc ne sera plus lisible/)]);
  });

  it("une vue liée ouvre sa base : prévient quand la cible est publiée", () => {
    const graph = graphOf(node("S"), node("B", { type: "database", title: "Ressources" }), node("P", { publicId: "pub_P", title: "Cible publiée" }));
    const lines = warn(graph, "P", [], [linked("B")]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/base « Ressources » deviendra lisible par le public/);
    expect(lines[1]).toMatch(/contenu de ce bloc/);
  });

  it("ne dit rien d'une base déjà lisible par ailleurs", () => {
    const graph = graphOf(node("S"), node("B", { type: "database", publicId: "pub_B" }), node("P", { publicId: "pub_P" }));
    expect(warn(graph, "P", [], [linked("B")]).filter((l) => /base/.test(l))).toEqual([]);
  });

  it("une vue liée qui quitte une page publiée ferme sa base", () => {
    const graph = graphOf(
      node("S", { publicId: "pub_S", opens: ["B"], links: ["B"] }),
      node("B", { type: "database", title: "Ressources" }),
      node("T"),
    );
    const lines = warn(graph, "T", [], [linked("B")]);
    expect(lines.some((l) => /base « Ressources » ne sera plus ouverte/.test(l))).toBe(true);
  });

  it("garde la base ouverte si une autre vue liée de la source subsiste", () => {
    const graph = graphOf(
      node("S", { publicId: "pub_S", opens: ["B", "B"], links: ["B", "B"] }),
      node("B", { type: "database" }),
      node("T"),
    );
    expect(warn(graph, "T", [], [linked("B")]).filter((l) => /base/.test(l))).toEqual([]);
  });

  it("laisse le graphe intact", () => {
    const graph = graphOf(...base());
    const copy = structuredClone([...graph.values()]);
    warn(graph, "T", ["A"], [sub("A")]);
    expect([...graph.values()]).toEqual(copy);
  });
});
