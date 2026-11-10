import { describe, expect, it } from "vitest";
import { BASES_ROOT_ID, fallbackParent, placementError, publishError, trashError } from "@/lib/bases";
import { ancestorRows, buildTree, linkChoices, type TreeRow } from "@/lib/tree";

// Étape 17 : la racine est une page sous « Ressources », marquée par son rôle.
const root = { type: "page" as const, isBasesRoot: true };
const folder = { type: "folder" as const };
const page = { type: "page" as const };
const database = { type: "database" as const };
const todo = { type: "database" as const, rootException: true };

describe("placementError", () => {
  it("range bases et dossiers sous la racine ou un de ses dossiers", () => {
    expect(placementError(database, root)).toBeNull();
    expect(placementError(database, folder)).toBeNull();
    expect(placementError(folder, root)).toBeNull();
    expect(placementError(folder, folder)).toBeNull();
    expect(placementError(database, null)).toBe("Une base ne vit que dans « Bases de données ».");
    expect(placementError(database, page)).toBe("Une base ne vit que dans « Bases de données ».");
    expect(placementError(folder, page)).toBe("Un dossier ne vit que dans « Bases de données ».");
    expect(placementError(database, database)).toBe("Une base ne vit que dans « Bases de données ».");
  });

  it("laisse les pages sous une page, la racine comprise", () => {
    expect(placementError(page, null)).toBeNull();
    expect(placementError(page, page)).toBeNull();
    expect(placementError(page, root)).toBeNull();
    expect(placementError(page, folder)).toBe("Seule une page peut recevoir des sous-pages.");
    expect(placementError(page, database)).toBe("Seule une page peut recevoir des sous-pages.");
  });

  it("laisse les entrées dans leur base seulement", () => {
    expect(placementError({ type: "entry" }, page)).toBe("Une entrée vit dans sa base.");
    expect(placementError({ type: "entry" }, root)).toBe("Une entrée vit dans sa base.");
  });

  it("laisse l'exception To Do à la racine de l'arbre, et sous « Bases de données »", () => {
    expect(placementError(todo, null)).toBeNull();
    expect(placementError(todo, root)).toBeNull();
    expect(placementError(todo, folder)).toBeNull();
    expect(placementError(todo, page)).toBe("Une base ne vit que dans « Bases de données ».");
    expect(placementError(todo, database)).toBe("Une base ne vit que dans « Bases de données ».");
    expect(placementError({ type: "folder", rootException: true }, null)).toBe("Un dossier ne vit que dans « Bases de données ».");
  });

  it("donne un repli à chaque type, avec la racine lue par son rôle", () => {
    expect(fallbackParent({ type: "database" }, BASES_ROOT_ID)).toBe(BASES_ROOT_ID);
    expect(fallbackParent({ type: "folder" }, BASES_ROOT_ID)).toBe(BASES_ROOT_ID);
    expect(fallbackParent({ type: "page" }, BASES_ROOT_ID)).toBeNull();
    expect(fallbackParent({ type: "database" }, null)).toBeNull();
    expect(fallbackParent(todo, BASES_ROOT_ID)).toBeNull();
    expect(fallbackParent(todo, null)).toBeNull();
  });
});

describe("rôles fixes", () => {
  it("refuse la corbeille à la racine des bases et au Vide-cerveau", () => {
    expect(trashError({ isBasesRoot: true, isInbox: false })).toBe("« Bases de données » ne va pas à la corbeille.");
    expect(trashError({ isBasesRoot: false, isInbox: true })).toBe("Le Vide-cerveau ne va pas à la corbeille.");
    expect(trashError({ isBasesRoot: false, isInbox: false })).toBeNull();
  });

  it("refuse la publication de la racine, du Vide-cerveau et d'un dossier", () => {
    expect(publishError(root)).toBe("La page « Bases de données » ne se publie pas.");
    expect(publishError({ type: "page", isInbox: true })).toBe("Le Vide-cerveau ne se publie pas.");
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

// « Bases de données » est une page sous « Ressources » ; ses bases et dossiers
// vivent dessous.
const rows: TreeRow[] = [
  row("Ressources", null, "page", { title: "Ressources" }),
  row(BASES_ROOT_ID, "Ressources", "page", { basesRoot: true, title: "Bases de données" }),
  row("Cours", BASES_ROOT_ID, "folder"),
  row("Séquences", "Cours", "database"),
  row("Vide-cerveau", BASES_ROOT_ID, "database", { inbox: true }),
];

describe("arbre avec la racine des bases", () => {
  it("garde l'ordre reçu, sans mise en tête", () => {
    expect(buildTree(rows).map((node) => node.id)).toEqual(["Ressources"]);
    expect(buildTree(rows)[0].children.map((node) => node.id)).toEqual([BASES_ROOT_ID]);
  });

  it("donne le fil d'une base, de la racine au parent", () => {
    expect(ancestorRows(rows, "Séquences").map((crumb) => crumb.title)).toEqual(["Ressources", "Bases de données", "Cours"]);
    expect(ancestorRows(rows, BASES_ROOT_ID).map((crumb) => crumb.title)).toEqual(["Ressources"]);
  });

  it("propose les bases avec leur chemin, jamais les dossiers", () => {
    const choices = linkChoices(rows, "Ressources", "");
    expect(choices.map((choice) => choice.row.id)).toEqual([BASES_ROOT_ID, "Séquences", "Vide-cerveau"]);
    expect(choices.find((choice) => choice.row.id === "Séquences")?.path).toEqual(["Ressources", "Bases de données", "Cours"]);
  });
});
