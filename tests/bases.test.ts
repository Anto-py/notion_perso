import { describe, expect, it } from "vitest";
import { BASES_ROOT_ID, fallbackParent, placementError, publishError, trashError } from "@/lib/bases";
import { FIRST_KEY } from "@/lib/order_key";
import { ancestorRows, basesHead, buildTree, linkChoices, type TreeRow } from "@/lib/tree";

const root = { type: "folder" as const, isBasesRoot: true };
const folder = { type: "folder" as const };
const page = { type: "page" as const };
const database = { type: "database" as const };

describe("placementError", () => {
  it("range bases et dossiers dans « Bases » seulement", () => {
    expect(placementError(database, root)).toBeNull();
    expect(placementError(database, folder)).toBeNull();
    expect(placementError(folder, folder)).toBeNull();
    expect(placementError(database, null)).toBe("Une base ne vit que dans « Bases ».");
    expect(placementError(database, page)).toBe("Une base ne vit que dans « Bases ».");
    expect(placementError(folder, page)).toBe("Un dossier ne vit que dans « Bases ».");
    expect(placementError(database, database)).toBe("Une base ne vit que dans « Bases ».");
  });

  it("garde les pages hors de « Bases »", () => {
    expect(placementError(page, null)).toBeNull();
    expect(placementError(page, page)).toBeNull();
    expect(placementError(page, root)).toBe("« Bases » ne range que des bases et des dossiers.");
    expect(placementError(page, folder)).toBe("« Bases » ne range que des bases et des dossiers.");
    expect(placementError(page, database)).toBe("Seule une page peut recevoir des sous-pages.");
  });

  it("laisse « Bases » à la racine et les entrées dans leur base", () => {
    expect(placementError(root, null)).toBeNull();
    expect(placementError(root, folder)).toBe("« Bases » reste à la racine de l'arbre.");
    expect(placementError({ type: "entry" }, page)).toBe("Une entrée vit dans sa base.");
  });

  it("donne un repli à chaque type", () => {
    expect(fallbackParent("database")).toBe(BASES_ROOT_ID);
    expect(fallbackParent("folder")).toBe(BASES_ROOT_ID);
    expect(fallbackParent("page")).toBeNull();
  });
});

describe("rôles fixes", () => {
  it("refuse la corbeille à « Bases » et au Vide-cerveau", () => {
    expect(trashError({ isBasesRoot: true, isInbox: false })).toBe("« Bases » ne va pas à la corbeille.");
    expect(trashError({ isBasesRoot: false, isInbox: true })).toBe("Le Vide-cerveau ne va pas à la corbeille.");
    expect(trashError({ isBasesRoot: false, isInbox: false })).toBeNull();
  });

  it("refuse la publication d'un dossier", () => {
    expect(publishError(folder)).not.toBeNull();
    expect(publishError(database)).toBeNull();
    expect(publishError(page)).toBeNull();
  });
});

const row = (id: string, parentId: string | null, type: TreeRow["type"], extra: Partial<TreeRow> = {}): TreeRow => ({
  id,
  parentId,
  type,
  title: id,
  icon: null,
  closed: false,
  ...extra,
});

// Pages d'abord dans l'ordre manuel, « Bases » rangée plus bas.
const rows: TreeRow[] = [
  row("Veille", null, "page"),
  row(BASES_ROOT_ID, null, "folder", { basesRoot: true, title: "Bases" }),
  row("Cours", BASES_ROOT_ID, "folder"),
  row("Séquences", "Cours", "database"),
  row("Vide-cerveau", BASES_ROOT_ID, "database", { inbox: true }),
];

describe("arbre avec « Bases »", () => {
  it("garde l'ordre reçu, la mise en tête revenant à basesHead", () => {
    expect(buildTree(rows).map((node) => node.id)).toEqual(["Veille", BASES_ROOT_ID]);
  });

  it("donne le fil d'une base, de la racine au parent", () => {
    expect(ancestorRows(rows, "Séquences").map((crumb) => crumb.title)).toEqual(["Bases", "Cours"]);
    expect(ancestorRows(rows, BASES_ROOT_ID)).toEqual([]);
  });

  it("propose les bases avec leur chemin, jamais les dossiers", () => {
    const choices = linkChoices(rows, "Veille", "");
    expect(choices.map((choice) => choice.row.id)).toEqual(["Séquences", "Vide-cerveau"]);
    expect(choices[0].path).toEqual(["Bases", "Cours"]);
  });
});

describe("basesHead", () => {
  type Ordered = TreeRow & { manualOrder: string };
  const at = (id: string, parentId: string | null, manualOrder: string, extra: Partial<TreeRow> = {}): Ordered => ({
    ...row(id, parentId, "page", extra),
    manualOrder,
  });

  it("remonte « Bases » en tête tant qu'il garde la clé par défaut", () => {
    const ordered = [at("Veille", null, FIRST_KEY), at(BASES_ROOT_ID, null, FIRST_KEY, { basesRoot: true })];
    expect(basesHead(ordered).map((line) => line.id)).toEqual([BASES_ROOT_ID, "Veille"]);
  });

  it("respecte une clé écrite par un déplacement", () => {
    const ordered = [at("Veille", null, FIRST_KEY), at(BASES_ROOT_ID, null, "a5", { basesRoot: true })];
    expect(basesHead(ordered).map((line) => line.id)).toEqual(["Veille", BASES_ROOT_ID]);
  });

  it("ne remonte pas devant une ligne déjà rangée avant lui", () => {
    const ordered = [at("Veille", null, "Zz"), at(BASES_ROOT_ID, null, FIRST_KEY, { basesRoot: true })];
    expect(basesHead(ordered).map((line) => line.id)).toEqual(["Veille", BASES_ROOT_ID]);
  });
});
