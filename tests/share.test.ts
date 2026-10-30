import { describe, expect, it } from "vitest";
import { loginPath, safeReturnPath, sharedPayload } from "@/lib/share";

describe("sharedPayload", () => {
  it("prend l'adresse du champ url quand le téléphone la fournit", () => {
    expect(sharedPayload({ title: "Le Monde", url: "https://lemonde.fr/a" })).toEqual({
      kind: "link",
      url: "https://lemonde.fr/a",
      title: "Le Monde",
    });
  });

  it("trouve l'adresse rangée dans text, comme sous Android", () => {
    expect(sharedPayload({ text: "L'IA à l'école https://exemple.org/article." })).toEqual({
      kind: "link",
      url: "https://exemple.org/article",
      title: "L'IA à l'école",
    });
  });

  it("garde la parenthèse d'une adresse qui en ouvre une", () => {
    const shared = sharedPayload({ text: "https://fr.wikipedia.org/wiki/Callimaque_(poète)" });
    expect(shared).toMatchObject({ url: "https://fr.wikipedia.org/wiki/Callimaque_(poète)" });
  });

  it("ôte la parenthèse fermante qui clôt une phrase", () => {
    expect(sharedPayload({ text: "(voir https://exemple.org/a)" })).toMatchObject({ url: "https://exemple.org/a" });
  });

  it("ignore une adresse qui n'est pas http et cherche dans le texte", () => {
    expect(sharedPayload({ url: "content://x", text: "https://exemple.org" })).toMatchObject({
      kind: "link",
      url: "https://exemple.org",
    });
  });

  it("fait une note d'un partage sans adresse, sans répéter un titre égal au texte", () => {
    expect(sharedPayload({ title: "Idée", text: "Débat en classe" })).toEqual({ kind: "note", text: "Idée\nDébat en classe" });
    expect(sharedPayload({ title: "Idée", text: "Idée" })).toEqual({ kind: "note", text: "Idée" });
  });

  it("signale un partage vide ou mal formé", () => {
    expect(sharedPayload({})).toEqual({ kind: "empty" });
    expect(sharedPayload({ title: ["a"], text: 3, url: null })).toEqual({ kind: "empty" });
  });
});

describe("safeReturnPath", () => {
  it("garde un chemin du site avec sa requête", () => {
    expect(safeReturnPath("/share?url=https%3A%2F%2Fa.org&title=A")).toBe("/share?url=https%3A%2F%2Fa.org&title=A");
  });

  it("refuse tout ce qui mènerait hors du site", () => {
    for (const raw of ["https://ailleurs.com", "//ailleurs.com", "/\\ailleurs.com", "javascript:alert(1)", "share", "", 42]) {
      expect(safeReturnPath(raw)).toBe("/");
    }
  });

  it("ne renvoie jamais vers la page de connexion", () => {
    expect(safeReturnPath("/login?suite=/x")).toBe("/");
  });
});

describe("loginPath", () => {
  it("transporte la suite encodée, et rien pour l'accueil", () => {
    expect(loginPath("/share?url=x")).toBe("/login?suite=%2Fshare%3Furl%3Dx");
    expect(loginPath("/")).toBe("/login");
  });
});
