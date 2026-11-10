import { describe, expect, it } from "vitest";
import { applyVitrinePatch, parseVitrinePatch, vitrineAddress } from "@/lib/vitrine_pilotage";

describe("parseVitrinePatch", () => {
  it("lit l'interrupteur et la page d'accueil, null retirant la page", () => {
    expect(parseVitrinePatch({ enabled: true })).toEqual({ enabled: true });
    expect(parseVitrinePatch({ welcomePageId: "pg_abc" })).toEqual({ welcomePageId: "pg_abc" });
    expect(parseVitrinePatch({ welcomePageId: null })).toEqual({ welcomePageId: null });
    expect(parseVitrinePatch({ enabled: false, welcomePageId: null })).toEqual({ enabled: false, welcomePageId: null });
  });

  it("refuse un corps vide, un interrupteur non booléen ou un id illisible", () => {
    expect(parseVitrinePatch(null)).toBeNull();
    expect(parseVitrinePatch({})).toBeNull();
    expect(parseVitrinePatch({ enabled: "true" })).toBeNull();
    expect(parseVitrinePatch({ welcomePageId: "" })).toBeNull();
    expect(parseVitrinePatch({ welcomePageId: "pg/../x" })).toBeNull();
    expect(parseVitrinePatch({ enabled: true, welcomePageId: 3 })).toBeNull();
  });
});

describe("applyVitrinePatch", () => {
  it("part d'une vitrine coupée sans page quand la base n'en a pas", () => {
    expect(applyVitrinePatch(undefined, { enabled: true })).toEqual({ enabled: true, welcomePageId: null });
  });

  it("ne change que ce que le geste nomme", () => {
    const current = { enabled: true, welcomePageId: "pg_old" };
    expect(applyVitrinePatch(current, { welcomePageId: "pg_new" })).toEqual({ enabled: true, welcomePageId: "pg_new" });
    expect(applyVitrinePatch(current, { welcomePageId: null })).toEqual({ enabled: true, welcomePageId: null });
    expect(applyVitrinePatch(current, { enabled: false })).toEqual({ enabled: false, welcomePageId: "pg_old" });
  });
});

describe("vitrineAddress", () => {
  it("rend le chemin seul sur l'instance web, l'adresse distante sur le Mac", () => {
    expect(vitrineAddress(null)).toBe("/veille");
    expect(vitrineAddress("https://notion.example.eu")).toBe("https://notion.example.eu/veille");
    expect(vitrineAddress("https://notion.example.eu/")).toBe("https://notion.example.eu/veille");
  });
});
