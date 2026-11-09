import { describe, expect, it } from "vitest";
import { clampSidebarWidth, parseSidebarState, sidebarStateText, SIDEBAR_BOOT, SIDEBAR_LIMITS, SIDEBAR_STORAGE_KEY } from "@/lib/sidebar";

describe("barre latérale", () => {
  it("borne la largeur entre 180 et 420, 260 par défaut", () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_LIMITS.min);
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_LIMITS.max);
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(undefined)).toBe(SIDEBAR_LIMITS.default);
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_LIMITS.default);
    expect(clampSidebarWidth("")).toBe(SIDEBAR_LIMITS.default);
    expect(clampSidebarWidth("abc")).toBe(SIDEBAR_LIMITS.default);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_LIMITS.default);
  });

  it("relit le réglage rangé, sinon les défauts", () => {
    expect(parseSidebarState('{"width":320,"hidden":true}')).toEqual({ width: 320, hidden: true });
    expect(parseSidebarState({ width: 999, hidden: false })).toEqual({ width: SIDEBAR_LIMITS.max, hidden: false });
    expect(parseSidebarState("pas du json")).toEqual({ width: SIDEBAR_LIMITS.default, hidden: false });
    expect(parseSidebarState(null)).toEqual({ width: SIDEBAR_LIMITS.default, hidden: false });
    expect(parseSidebarState({ width: "200", hidden: "oui" })).toEqual({ width: 200, hidden: false });
  });

  it("écrit un texte relu à l'identique", () => {
    expect(parseSidebarState(sidebarStateText({ width: 1000, hidden: true }))).toEqual({ width: SIDEBAR_LIMITS.max, hidden: true });
  });

  it("le script posé avant peinture est du JavaScript valide", () => {
    expect(() => new Function(SIDEBAR_BOOT)).not.toThrow();
    expect(SIDEBAR_BOOT).toContain(SIDEBAR_STORAGE_KEY);
  });
});
