import { describe, expect, it } from "vitest";
import { newPasswordProblem, parseSettingWrite, readSettingValue, sectionsFor } from "@/lib/settings_rules";

describe("sectionsFor", () => {
  it("montre Appareils et Vue publique sur l'app web, jamais Synchronisation ni Sauvegardes", () => {
    expect(sectionsFor("web")).toEqual(["compte", "version", "appareils", "vue_publique"]);
  });

  it("montre Synchronisation et Sauvegardes sur le Mac, jamais Appareils ni Vue publique", () => {
    expect(sectionsFor("mac")).toEqual(["compte", "synchronisation", "sauvegardes", "version"]);
  });
});

describe("parseSettingWrite", () => {
  it("accepte le nom du site sur l'app web, sans espaces autour", () => {
    expect(parseSettingWrite("web", "public.site_name", "  Veille d'Antonin ")).toEqual({
      ok: true,
      key: "public.site_name",
      value: "Veille d'Antonin",
    });
  });

  it("lit un champ vidé comme un retour au repli", () => {
    expect(parseSettingWrite("web", "public.site_name", "   ")).toEqual({ ok: true, key: "public.site_name", value: null });
    expect(parseSettingWrite("web", "public.linkedin_url", "")).toEqual({
      ok: true,
      key: "public.linkedin_url",
      value: null,
    });
  });

  it("refuse un nom de site trop long", () => {
    expect(parseSettingWrite("web", "public.site_name", "x".repeat(81)).ok).toBe(false);
  });

  it("normalise un lien https et refuse les autres protocoles", () => {
    expect(parseSettingWrite("web", "public.linkedin_url", " https://www.linkedin.com/in/antonin ")).toEqual({
      ok: true,
      key: "public.linkedin_url",
      value: "https://www.linkedin.com/in/antonin",
    });
    expect(parseSettingWrite("web", "public.linkedin_url", "http://www.linkedin.com/in/antonin").ok).toBe(false);
    expect(parseSettingWrite("web", "public.linkedin_url", "javascript:alert(1)").ok).toBe(false);
    expect(parseSettingWrite("web", "public.linkedin_url", "linkedin.com/in/antonin").ok).toBe(false);
  });

  it("refuse une clé dont la section n'est pas affichée sur cette instance", () => {
    expect(parseSettingWrite("mac", "public.site_name", "Veille")).toEqual({
      ok: false,
      error: "Réglage indisponible sur cette instance",
    });
  });

  it("refuse une clé inconnue et une valeur qui n'est pas du texte", () => {
    expect(parseSettingWrite("web", "sync.inconnue", "x").ok).toBe(false);
    expect(parseSettingWrite("web", "__proto__", "x").ok).toBe(false);
    expect(parseSettingWrite("web", "public.site_name", 42).ok).toBe(false);
  });
});

describe("readSettingValue", () => {
  it("rend la valeur stockée si sa forme est la bonne, null sinon", () => {
    expect(readSettingValue("public.site_name", "Veille")).toBe("Veille");
    expect(readSettingValue("public.site_name", { nom: "Veille" })).toBeNull();
    expect(readSettingValue("public.linkedin_url", "ftp://exemple.org")).toBeNull();
  });
});

describe("réglages de la synchronisation", () => {
  it("accepte le seuil sur le Mac, en texte comme en nombre, et le refuse sur l'app web", () => {
    expect(parseSettingWrite("mac", "sync.threshold", " 50 ")).toEqual({ ok: true, key: "sync.threshold", value: 50 });
    expect(parseSettingWrite("mac", "sync.threshold", 5)).toEqual({ ok: true, key: "sync.threshold", value: 5 });
    expect(parseSettingWrite("mac", "sync.threshold", "")).toEqual({ ok: true, key: "sync.threshold", value: null });
    expect(parseSettingWrite("web", "sync.threshold", "50").ok).toBe(false);
  });

  it("refuse un seuil nul, négatif, décimal ou démesuré", () => {
    for (const value of ["0", "-3", "2.5", "vingt", 0, 1.5, 10_001]) {
      expect(parseSettingWrite("mac", "sync.threshold", value).ok).toBe(false);
    }
  });

  it("n'écrit jamais l'état de suspension ni l'accord par PATCH", () => {
    expect(parseSettingWrite("mac", "sync.suspended", "x").ok).toBe(false);
    expect(parseSettingWrite("mac", "sync.waiver", "up").ok).toBe(false);
  });

  it("relit une suspension manuelle ou automatique, et écarte une forme inattendue", () => {
    const at = "2026-11-01T10:00:00.000Z";
    expect(readSettingValue("sync.suspended", { at, by: "manual" })).toEqual({ at, by: "manual" });
    const auto = {
      at,
      by: "auto",
      direction: "down",
      count: 40,
      kinds: { trashed: 0, emptied: 0, purged: 40 },
      titles: ["Veille"],
    };
    expect(readSettingValue("sync.suspended", auto)).toEqual(auto);
    expect(readSettingValue("sync.suspended", { ...auto, direction: "sideways" })).toBeNull();
    expect(readSettingValue("sync.suspended", { ...auto, kinds: { trashed: 1 } })).toBeNull();
    expect(readSettingValue("sync.suspended", "manual")).toBeNull();
    expect(readSettingValue("sync.waiver", { direction: "up" })).toEqual({ direction: "up" });
    expect(readSettingValue("sync.waiver", { direction: "left" })).toBeNull();
    expect(readSettingValue("sync.threshold", 30)).toBe(30);
    expect(readSettingValue("sync.threshold", "trente")).toBeNull();
  });
});

describe("newPasswordProblem", () => {
  it("exige 10 caractères au moins", () => {
    expect(newPasswordProblem("ancien mot de passe", "court")).toMatch(/10 caractères/);
    expect(newPasswordProblem("ancien mot de passe", "x".repeat(9))).toMatch(/10 caractères/);
    expect(newPasswordProblem("ancien mot de passe", "x".repeat(10))).toBeNull();
  });

  it("refuse un nouveau mot de passe identique à l'actuel", () => {
    expect(newPasswordProblem("le même depuis 2020", "le même depuis 2020")).toMatch(/identique/);
  });

  it("refuse un mot de passe actuel vide", () => {
    expect(newPasswordProblem("", "assez long ici")).toMatch(/actuel/);
  });
});
