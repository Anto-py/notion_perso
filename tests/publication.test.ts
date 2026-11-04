import { describe, expect, it } from "vitest";
import {
  closedBy,
  crumbTrail,
  linkTargets,
  privateTargets,
  publicationOf,
  publicHref,
  publishedBelow,
  reachPath,
  shareReach,
  treePath,
  type ShareGraph,
  type ShareNode,
} from "@/lib/publication";

function node(id: string, extra: Partial<ShareNode> = {}): ShareNode {
  return { id, type: "page", parentId: null, dbId: null, closed: false, publicId: null, title: id, icon: null, links: [], ...extra };
}

function graphOf(...nodes: ShareNode[]): Map<string, ShareNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// root (publiée) → sub → base → e1, e2 ; brouillon, sous-page exclue de root,
// avec un enfant et une page publiée à part ; root cite veille (publiée à
// part, rangée dans « Bases »), privee (jamais publiée), une sous-page de
// secret (exclue) et une page disparue. L'entrée v1 de veille cite far
// (publiée à part), qui cite root en retour (boucle).
const graph: ShareGraph = graphOf(
  node("root", { publicId: "pub", links: ["veille", "brouillon", "secretchild", "gone", "privee"] }),
  node("sub", { parentId: "root" }),
  node("base", { type: "database", parentId: "sub" }),
  node("e1", { type: "entry", dbId: "base" }),
  node("e2", { type: "entry", dbId: "base" }),
  node("brouillon", { parentId: "root", closed: true }),
  node("brouillonchild", { parentId: "brouillon" }),
  node("inner", { parentId: "brouillon", publicId: "pubI" }),
  node("Bases"),
  node("veille", { type: "database", parentId: "Bases", publicId: "pubV" }),
  node("v1", { type: "entry", dbId: "veille", links: ["far"] }),
  node("far", { publicId: "pubF", links: ["root"] }),
  node("farchild", { parentId: "far" }),
  node("privee"),
  node("secret", { closed: true }),
  node("secretchild", { parentId: "secret" }),
);

describe("shareReach", () => {
  it("suit l'arbre, puis les liens vers des pages publiées, de lien en lien, et rend le précédent", () => {
    const reach = shareReach(graph, "root");
    expect([...reach.keys()].sort()).toEqual(["base", "e1", "e2", "far", "farchild", "root", "sub", "veille", "v1"].sort());
    expect(Object.fromEntries(reach)).toMatchObject({ root: null, sub: "root", veille: "root", v1: "veille", far: "v1", farchild: "far" });
  });

  it("ne mène pas à une page non publiée, ni exclue, ni disparue, même citée", () => {
    const reach = shareReach(graph, "root");
    for (const id of ["privee", "secretchild", "Bases", "gone"]) expect(reach.has(id)).toBe(false);
  });

  it("n'entre pas dans une sous-page exclue ni ce qui est rangé dessous", () => {
    const reach = shareReach(graph, "root");
    for (const id of ["brouillon", "brouillonchild", "inner"]) expect(reach.has(id)).toBe(false);
  });

  it("perd la chaîne quand la base citée n'est plus publiée", () => {
    const unpublished = new Map(graph);
    unpublished.set("veille", node("veille", { type: "database", parentId: "Bases" }));
    const reach = shareReach(unpublished, "root");
    for (const id of ["veille", "v1", "far"]) expect(reach.has(id)).toBe(false);
  });

  it("prend le chemin le plus court, et retirer le lien retire sa cible", () => {
    const shortcut = new Map(graph);
    shortcut.set("root", node("root", { publicId: "pub", links: ["base", "veille"] }));
    expect(shareReach(shortcut, "root").get("base")).toBe("root");
    const unlinked = new Map(graph);
    unlinked.set("root", node("root", { publicId: "pub" }));
    expect(shareReach(unlinked, "root").has("veille")).toBe(false);
  });

  it("rend une portée vide pour une racine absente, et s'arrête sur une boucle de parents", () => {
    expect(shareReach(graph, "absente").size).toBe(0);
    const loop = graphOf(node("a", { parentId: "b", publicId: "pa", links: ["b"] }), node("b", { parentId: "a" }));
    expect([...shareReach(loop, "a").keys()]).toEqual(["a", "b"]);
  });
});

describe("publicationOf et publishedBelow", () => {
  it("trouve la publication qui rend une page lisible, sauf exclusion interposée", () => {
    expect(publicationOf(graph, "v1")).toEqual({ publicId: "pubV", rootId: "veille" });
    expect(publicationOf(graph, "e2")).toEqual({ publicId: "pub", rootId: "root" });
    expect(publicationOf(graph, "brouillonchild")).toBeNull();
    expect(publicationOf(graph, "inner")).toEqual({ publicId: "pubI", rootId: "inner" });
    expect(publicationOf(graph, "privee")).toBeNull();
  });

  it("liste les pages publiées rangées dessous, la page elle-même exclue", () => {
    expect(publishedBelow(graph, "Bases").map((n) => n.id)).toEqual(["veille"]);
    expect(publishedBelow(graph, "brouillon").map((n) => n.id)).toEqual(["inner"]);
    expect(publishedBelow(graph, "sub")).toEqual([]);
    expect(publishedBelow(graph, "veille")).toEqual([]);
  });
});

describe("closedBy", () => {
  it("nomme la page qui ferme : elle-même, son ancêtre, ou la base d'une entrée", () => {
    expect(closedBy(graph, "secret")).toBe("secret");
    expect(closedBy(graph, "secretchild")).toBe("secret");
    expect(closedBy(graph, "v1")).toBeNull();
    const closedBase = new Map(graph);
    closedBase.set("veille", node("veille", { type: "database", parentId: "Bases", closed: true }));
    expect(closedBy(closedBase, "v1")).toBe("veille");
  });
});

describe("linkTargets", () => {
  it("garde les ids nus et les adresses internes, écarte le reste", () => {
    expect(linkTargets(["pg_a", "/page/pg_b", "/db/pg_c?vue=1", "/api/media/up_x.png", "https://x.eu/page/pg_d", "pas un id", 42])).toEqual([
      "pg_a",
      "pg_b",
      "pg_c",
    ]);
  });
});

describe("reachPath, privateTargets, treePath", () => {
  const reach = shareReach(graph, "root");

  it("trace le chemin du visiteur, de la racine à la page", () => {
    expect(reachPath(graph, reach, "farchild").map((n) => n.id)).toEqual(["root", "veille", "v1", "far", "farchild"]);
    expect(reachPath(graph, reach, "privee")).toEqual([]);
  });

  it("liste une fois les cibles vivantes que le visiteur ne lit pas, dans l'ordre du parcours", () => {
    expect(privateTargets(graph, reach).map((n) => n.id)).toEqual(["brouillon", "secretchild", "privee"]);
  });

  it("donne les titres des ancêtres réels, de la racine au parent", () => {
    expect(treePath(graph, "v1")).toEqual(["Bases", "veille"]);
    expect(treePath(graph, "Bases")).toEqual([]);
  });
});

describe("publicHref", () => {
  it("adresse la racine par son seul identifiant, le reste sous lui", () => {
    expect(publicHref("pub", "root", "root")).toBe("/p/pub");
    expect(publicHref("pub", "root", "entry")).toBe("/p/pub/entry");
  });
});

describe("crumbTrail, le fil d'Ariane", () => {
  const reach = shareReach(graph, "root");
  const href = (id: string) => publicHref("pub", "root", id);
  const trail = (id: string) => crumbTrail(reachPath(graph, reach, id), href).map(({ title, href }) => [title, href]);

  it("la page publiée montre son propre titre, sans lien", () => {
    expect(trail("root")).toEqual([["root", null]]);
  });

  it("une entrée atteinte par un lien suit le parcours, sans nommer « Bases »", () => {
    expect(trail("v1")).toEqual([
      ["root", "/p/pub"],
      ["veille", "/p/pub/veille"],
      ["v1", null],
    ]);
  });

  it("une page rangée dessous suit ses parents, chaque élément sauf le dernier menant à sa page", () => {
    expect(trail("e2")).toEqual([
      ["root", "/p/pub"],
      ["sub", "/p/pub/sub"],
      ["base", "/p/pub/base"],
      ["e2", null],
    ]);
  });

  it("un chemin vide reste vide", () => {
    expect(crumbTrail([], href)).toEqual([]);
  });
});
