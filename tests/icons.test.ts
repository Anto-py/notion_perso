import { describe, expect, it } from "vitest";
import {
  checkIconUpload,
  checkIconValue,
  cleanIconName,
  faviconHref,
  ICON_MAX_BYTES,
  imageIcon,
  matchesIconName,
  nameFromFile,
  parseIcon,
  resolveIcon,
} from "@/lib/icons";

const FILE = "up_AbCdEfGhIjKlMnOp.png";

describe("parseIcon et resolveIcon", () => {
  it("lit un emoji tel quel et une image par son préfixe", () => {
    expect(parseIcon("📝")).toEqual({ kind: "emoji", emoji: "📝" });
    expect(parseIcon(imageIcon(FILE))).toEqual({ kind: "image", filename: FILE });
  });

  it("ignore une image au nom invalide ou un PDF", () => {
    expect(parseIcon("image:../etc/passwd")).toBeNull();
    expect(parseIcon("image:up_AbCdEfGhIjKlMnOp.pdf")).toBeNull();
  });

  it("retombe sur 📄 pour une page ou une entrée, 🗃️ pour une base", () => {
    expect(resolveIcon(null, "page")).toEqual({ kind: "emoji", emoji: "📄" });
    expect(resolveIcon(null, "entry")).toEqual({ kind: "emoji", emoji: "📄" });
    expect(resolveIcon("", "database")).toEqual({ kind: "emoji", emoji: "🗃️" });
    expect(resolveIcon("🎯", "database")).toEqual({ kind: "emoji", emoji: "🎯" });
  });
});

describe("checkIconValue", () => {
  it("admet null, un emoji composé et une image de la bibliothèque", () => {
    expect(checkIconValue(null)).toEqual({ ok: true, value: null, filename: null });
    expect(checkIconValue("👩🏽‍💻")).toMatchObject({ ok: true, filename: null });
    expect(checkIconValue("🏴󠁧󠁢󠁥󠁮󠁧󠁿")).toMatchObject({ ok: true });
    expect(checkIconValue(imageIcon(FILE))).toEqual({ ok: true, value: imageIcon(FILE), filename: FILE });
  });

  it("refuse le texte, le HTML, une image invalide et ce qui n'est pas une chaîne", () => {
    expect(checkIconValue("abc")).toEqual({ ok: false });
    expect(checkIconValue("<b>")).toEqual({ ok: false });
    expect(checkIconValue("📝 📝")).toEqual({ ok: false });
    expect(checkIconValue("image:nimporte")).toEqual({ ok: false });
    expect(checkIconValue("🎯".repeat(9))).toEqual({ ok: false });
    expect(checkIconValue(42)).toEqual({ ok: false });
  });
});

describe("checkIconUpload", () => {
  it("accepte une image jusqu'à 5 Mo", () => {
    expect(checkIconUpload({ size: ICON_MAX_BYTES, type: "image/webp" })).toEqual({ ok: true, ext: "webp" });
  });

  it("refuse au-delà de 5 Mo, un PDF et le SVG", () => {
    const heavy = checkIconUpload({ size: ICON_MAX_BYTES + 1, type: "image/png" });
    expect(heavy).toMatchObject({ ok: false, status: 413 });
    if (!heavy.ok) expect(heavy.error).toContain("5 Mo");
    expect(checkIconUpload({ size: 10, type: "application/pdf" })).toMatchObject({ ok: false, status: 415 });
    expect(checkIconUpload({ size: 10, type: "image/svg+xml" })).toMatchObject({ ok: false, status: 415 });
  });
});

describe("noms d'image", () => {
  it("propose le nom du fichier sans extension, rien pour une image collée", () => {
    expect(nameFromFile("logo_edulab.png")).toBe("logo_edulab");
    expect(nameFromFile("photo de classe.final.jpg")).toBe("photo de classe.final");
    expect(nameFromFile("image.png")).toBe("");
  });

  it("resserre les espaces, exige un caractère, coupe à 100", () => {
    expect(cleanIconName("  Logo   Edulab ")).toBe("Logo Edulab");
    expect(cleanIconName("   ")).toBeNull();
    expect(cleanIconName(12)).toBeNull();
    expect(cleanIconName("a".repeat(150))).toHaveLength(100);
  });

  it("cherche sans casse ni accents", () => {
    expect(matchesIconName("Logo Édulab", "edulab")).toBe(true);
    expect(matchesIconName("logo_edulab", "ÉDU")).toBe(true);
    expect(matchesIconName("École", "lycée")).toBe(false);
    expect(matchesIconName("École", "  ")).toBe(true);
  });
});

describe("faviconHref", () => {
  it("sert une image par la route des médias", () => {
    expect(faviconHref(imageIcon(FILE))).toBe(`/api/media/${FILE}`);
  });

  it("change un emoji, ou le défaut du type, en SVG data:", () => {
    expect(decodeURIComponent(faviconHref("🎯"))).toContain(">🎯</text>");
    expect(decodeURIComponent(faviconHref(null, "database"))).toContain(">🗃️</text>");
    expect(faviconHref(null)).toMatch(/^data:image\/svg\+xml,/);
  });
});
