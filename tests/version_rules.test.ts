import { describe, expect, it } from "vitest";
import {
  fallbackProblem,
  formatDemand,
  isCommit,
  parsePreparation,
  parseVersionRequest,
  preparationState,
  sameCommit,
} from "../src/lib/version_rules";

const LONG = "0a2197f3c4d5e6f708192a3b4c5d6e7f80912345";

describe("isCommit et sameCommit", () => {
  it("admet un commit court ou long en hexadécimal minuscule", () => {
    expect(isCommit("0a2197f")).toBe(true);
    expect(isCommit(LONG)).toBe(true);
    expect(isCommit("0a2197")).toBe(false);
    expect(isCommit("0A2197F")).toBe(false);
    expect(isCommit("0a2197f; rm -rf /")).toBe(false);
    expect(isCommit(42)).toBe(false);
  });

  it("reconnaît un commit court dans son commit long, dans les deux sens", () => {
    expect(sameCommit("0a2197f", LONG)).toBe(true);
    expect(sameCommit(LONG, "0a2197f")).toBe(true);
    expect(sameCommit("90bf8a4", LONG)).toBe(false);
    expect(sameCommit(null, LONG)).toBe(false);
  });
});

describe("parsePreparation", () => {
  it("lit une construction en cours et un échec", () => {
    expect(parsePreparation(`${LONG} 4242\n`)).toEqual({ commit: LONG, pid: 4242 });
    expect(parsePreparation(`${LONG} echec`)).toEqual({ commit: LONG, failed: true });
  });

  it("refuse un fichier absent, vide ou mal formé", () => {
    expect(parsePreparation(null)).toBeNull();
    expect(parsePreparation("")).toBeNull();
    expect(parsePreparation(LONG)).toBeNull();
    expect(parsePreparation(`${LONG} 0`)).toBeNull();
    expect(parsePreparation(`${LONG} 12 34`)).toBeNull();
    expect(parsePreparation("main 4242")).toBeNull();
  });
});

describe("preparationState", () => {
  const running = { commit: LONG, pid: 4242 };

  it("dit prête une version construite, quel que soit le marqueur", () => {
    expect(preparationState({ commit: LONG, built: true, marker: null, alive: false })).toBe("prete");
    expect(preparationState({ commit: LONG, built: true, marker: { commit: LONG, failed: true }, alive: false })).toBe("prete");
  });

  it("suit la construction tant que son processus vit", () => {
    expect(preparationState({ commit: LONG, built: false, marker: running, alive: true })).toBe("en_cours");
    expect(preparationState({ commit: "0a2197f", built: false, marker: running, alive: true })).toBe("en_cours");
  });

  it("dit l'échec, écrit ou deviné à un processus mort", () => {
    expect(preparationState({ commit: LONG, built: false, marker: { commit: LONG, failed: true }, alive: false })).toBe("echec");
    expect(preparationState({ commit: LONG, built: false, marker: running, alive: false })).toBe("echec");
  });

  it("ignore le marqueur d'un autre commit", () => {
    expect(preparationState({ commit: "90bf8a4", built: false, marker: running, alive: true })).toBe("a_preparer");
    expect(preparationState({ commit: LONG, built: false, marker: null, alive: false })).toBe("a_preparer");
  });
});

describe("fallbackProblem", () => {
  const fallback = { commit: "90bf8a4", schema: 1761990000000 };

  it("permet le retour à schéma égal", () => {
    expect(fallbackProblem(fallback, 1761990000000, false)).toBeNull();
  });

  it("le refuse à schéma différent, sans secours ou déjà en secours", () => {
    expect(fallbackProblem(fallback, 1762000000000, false)).toMatch(/schéma/);
    expect(fallbackProblem(null, 1761990000000, false)).toMatch(/Aucune version de secours/);
    expect(fallbackProblem(fallback, 1761990000000, true)).toMatch(/Déjà en version de secours/);
  });
});

describe("formatDemand", () => {
  it("écrit la ligne que lit le lanceur", () => {
    expect(formatDemand({ kind: "maj", commit: LONG })).toBe(`maj ${LONG}\n`);
    expect(formatDemand({ kind: "secours" })).toBe("secours\n");
  });
});

describe("parseVersionRequest", () => {
  it("lit les trois actions", () => {
    expect(parseVersionRequest({ action: "preparer", commit: LONG })).toEqual({ action: "preparer", commit: LONG });
    expect(parseVersionRequest({ action: "redemarrer", commit: "0a2197f" })).toEqual({ action: "redemarrer", commit: "0a2197f" });
    expect(parseVersionRequest({ action: "secours", commit: "ignoré" })).toEqual({ action: "secours" });
  });

  it("refuse une action inconnue ou un commit douteux", () => {
    expect(parseVersionRequest(null)).toBeNull();
    expect(parseVersionRequest({ action: "preparer" })).toBeNull();
    expect(parseVersionRequest({ action: "redemarrer", commit: "--help" })).toBeNull();
    expect(parseVersionRequest({ action: "effacer", commit: LONG })).toBeNull();
  });
});
