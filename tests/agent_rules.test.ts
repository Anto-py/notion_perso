import { describe, expect, it } from "vitest";
import { checkTokenName, MODEL_MAX, parseBearer, parseModel, publicOrigin, touchDue } from "@/lib/agent_rules";

describe("parseBearer", () => {
  it("lit un jeton base64url", () => {
    expect(parseBearer("Bearer abcdefghijklmnopqrstuvwxyz_-0123")).toBe("abcdefghijklmnopqrstuvwxyz_-0123");
  });

  it("refuse l'absence, un autre schéma, un jeton trop court ou mal formé", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(parseBearer("Bearer court")).toBeNull();
    expect(parseBearer("Bearer abcdefghijklmnop qrstuvwxyz")).toBeNull();
    expect(parseBearer("Bearer abcdefghijklmnopqrstuvwxyz=")).toBeNull();
  });
});

describe("parseModel", () => {
  it("garde le nom déclaré, sans espaces de bord", () => {
    expect(parseModel("  claude-opus-5-5 ")).toBe("claude-opus-5-5");
  });

  it("rend null pour une valeur absente ou vide", () => {
    expect(parseModel(null)).toBeNull();
    expect(parseModel("   ")).toBeNull();
  });

  it("retire les caractères de contrôle et borne la longueur", () => {
    expect(parseModel("gpt\u0000-5\n")).toBe("gpt-5");
    expect(parseModel("x".repeat(200))).toHaveLength(MODEL_MAX);
  });
});

describe("checkTokenName", () => {
  it("accepte un nom, sans espaces de bord", () => {
    expect(checkTokenName("  Harnais Mac ")).toEqual({ value: "Harnais Mac" });
  });

  it("refuse un nom absent, vide, trop long ou qui n'est pas un texte", () => {
    expect(checkTokenName(undefined)).toHaveProperty("error");
    expect(checkTokenName("   ")).toHaveProperty("error");
    expect(checkTokenName("x".repeat(61))).toHaveProperty("error");
    expect(checkTokenName(42)).toHaveProperty("error");
  });
});

describe("touchDue", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("date un jeton jamais utilisé", () => {
    expect(touchDue(null, now)).toBe(true);
  });

  it("ne redate pas avant une minute, redate ensuite", () => {
    expect(touchDue(new Date("2026-11-10T11:59:30Z"), now)).toBe(false);
    expect(touchDue(new Date("2026-11-10T11:59:00Z"), now)).toBe(true);
  });
});

describe("publicOrigin", () => {
  it("bâtit l'origine sur l'hôte demandé, https par défaut", () => {
    expect(publicOrigin("notion.antoninbareau.eu", null)).toBe("https://notion.antoninbareau.eu");
    expect(publicOrigin("notion.antoninbareau.eu", "https,http")).toBe("https://notion.antoninbareau.eu");
    expect(publicOrigin("localhost:3000", null)).toBe("http://localhost:3000");
    expect(publicOrigin("exemple.be", "http")).toBe("http://exemple.be");
  });

  it("refuse un hôte absent ou malformé", () => {
    expect(publicOrigin(null, null)).toBeNull();
    expect(publicOrigin("ex.be/chemin", null)).toBeNull();
    expect(publicOrigin("ex.be@autre", null)).toBeNull();
  });
});
