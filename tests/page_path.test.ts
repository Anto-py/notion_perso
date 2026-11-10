import { describe, expect, it } from "vitest";
import { joinPath, looksLikeId, resolvePath, splitPath, titlesOf, type PathRow } from "@/lib/page_path";

const ROWS: PathRow[] = [
  { id: "projets", parentId: null, type: "page", title: "Projets" },
  { id: "linux", parentId: "projets", type: "page", title: "Linux" },
  { id: "ressources", parentId: null, type: "page", title: "Ressources" },
  { id: "bases", parentId: "ressources", type: "page", title: "Bases de données" },
  { id: "todo", parentId: "bases", type: "database", title: "To Do" },
  { id: "e1", parentId: "todo", type: "entry", title: "Installer Linux" },
  { id: "notes", parentId: null, type: "page", title: "Notes" },
  { id: "linux2", parentId: "notes", type: "page", title: "linux" },
  { id: "slash", parentId: "notes", type: "page", title: "Entrée / sortie" },
  { id: "vide", parentId: "notes", type: "page", title: "" },
  { id: "orpheline", parentId: "corbeille", type: "page", title: "Orpheline" },
];

describe("splitPath et joinPath", () => {
  it("coupe sur les barres, garde une barre échappée, ignore les segments vides", () => {
    expect(splitPath(" Projets / Linux/ ")).toEqual(["Projets", "Linux"]);
    expect(splitPath("Notes/Entrée \\/ sortie")).toEqual(["Notes", "Entrée / sortie"]);
    expect(splitPath("")).toEqual([]);
  });

  it("échappe la barre d'un titre et nomme une page sans titre", () => {
    expect(joinPath(["Notes", "Entrée / sortie"])).toBe("Notes/Entrée \\/ sortie");
    expect(joinPath(["Notes", ""])).toBe("Notes/Sans titre");
  });
});

describe("resolvePath", () => {
  const resolve = (path: string) => resolvePath(ROWS, splitPath(path));

  it("descend depuis les racines, sans accents ni casse", () => {
    expect(resolve("projets/LINUX")).toEqual({ kind: "found", id: "linux" });
    expect(resolve("Ressources/Bases de donnees/To Do/Installer linux")).toEqual({ kind: "found", id: "e1" });
    expect(resolve("Notes/Entrée \\/ sortie")).toEqual({ kind: "found", id: "slash" });
    expect(resolve("Notes/Sans titre")).toEqual({ kind: "found", id: "vide" });
  });

  it("retombe sur la fin d'un chemin complet", () => {
    expect(resolve("To Do")).toEqual({ kind: "found", id: "todo" });
    expect(resolve("Bases de données/To Do")).toEqual({ kind: "found", id: "todo" });
  });

  it("une page au parent absent est une racine", () => {
    expect(resolve("Orpheline")).toEqual({ kind: "found", id: "orpheline" });
  });

  it("liste les candidats d'un chemin ambigu, triés par chemin", () => {
    expect(resolve("Linux")).toEqual({
      kind: "ambiguous",
      candidates: [
        { id: "linux2", type: "page", path: "Notes/linux" },
        { id: "linux", type: "page", path: "Projets/Linux" },
      ],
    });
  });

  it("rend none quand rien ne répond", () => {
    expect(resolve("Projets/Windows")).toEqual({ kind: "none" });
    expect(resolve("")).toEqual({ kind: "none" });
  });
});

describe("titlesOf et looksLikeId", () => {
  it("remonte jusqu'à la racine", () => {
    const byId = new Map(ROWS.map((row) => [row.id, row]));
    expect(titlesOf(byId, "e1")).toEqual(["Ressources", "Bases de données", "To Do", "Installer Linux"]);
  });

  it("reconnaît un identifiant de ligne", () => {
    expect(looksLikeId("pg_0123456789abcdef")).toBe(true);
    expect(looksLikeId("pg_0123-4567_89abcd")).toBe(true);
    expect(looksLikeId("Projets/Linux")).toBe(false);
    expect(looksLikeId("pg_court")).toBe(false);
  });
});
