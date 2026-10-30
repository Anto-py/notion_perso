import { describe, expect, it } from "vitest";
import { publicChain, publicHref, type PublicNode } from "@/lib/publication";

function node(id: string, extra: Partial<PublicNode> = {}): PublicNode {
  return { id, type: "page", parentId: null, dbId: null, trashed: false, publicId: null, title: id, icon: null, ...extra };
}

// racine publiée → sous-page → base → entrée ; une page voisine non publiée.
const nodes = new Map<string, PublicNode>(
  [
    node("root", { publicId: "pub" }),
    node("sub", { parentId: "root" }),
    node("base", { type: "database", parentId: "sub" }),
    node("entry", { type: "entry", dbId: "base" }),
    node("other"),
  ].map((n) => [n.id, n]),
);
const isRoot = (n: PublicNode) => n.id === "root";

describe("publicChain", () => {
  it("donne le chemin de la racine à la page, entrées comprises (par leur base)", () => {
    expect(publicChain(nodes, "entry", isRoot)?.map((n) => n.id)).toEqual(["root", "sub", "base", "entry"]);
    expect(publicChain(nodes, "root", isRoot)?.map((n) => n.id)).toEqual(["root"]);
  });

  it("refuse une page qui ne descend pas de la racine", () => {
    expect(publicChain(nodes, "other", isRoot)).toBeNull();
    expect(publicChain(nodes, "absente", isRoot)).toBeNull();
  });

  it("refuse dès qu'un maillon est en corbeille, racine comprise", () => {
    const trashed = new Map(nodes);
    trashed.set("sub", node("sub", { parentId: "root", trashed: true }));
    expect(publicChain(trashed, "entry", isRoot)).toBeNull();
    const rootTrashed = new Map(nodes);
    rootTrashed.set("root", node("root", { publicId: "pub", trashed: true }));
    expect(publicChain(rootTrashed, "root", isRoot)).toBeNull();
  });

  it("ne suit pas le parent d'une entrée, seulement sa base", () => {
    const odd = new Map(nodes);
    odd.set("entry", node("entry", { type: "entry", dbId: null, parentId: "root" }));
    expect(publicChain(odd, "entry", isRoot)).toBeNull();
  });

  it("s'arrête sur une boucle au lieu de tourner sans fin", () => {
    const loop = new Map<string, PublicNode>([
      ["a", node("a", { parentId: "b" })],
      ["b", node("b", { parentId: "a" })],
    ]);
    expect(publicChain(loop, "a", isRoot)).toBeNull();
  });
});

describe("publicHref", () => {
  it("adresse la racine par son seul identifiant, le reste sous lui", () => {
    expect(publicHref("pub", "root", "root")).toBe("/p/pub");
    expect(publicHref("pub", "root", "entry")).toBe("/p/pub/entry");
  });
});
