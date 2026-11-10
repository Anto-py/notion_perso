import { describe, expect, it } from "vitest";
import { LOGO_FRESH_MS, logoCandidates, logoFresh, logoHost, logoTarget } from "@/lib/vitrine_logo";

describe("logoHost", () => {
  it("admet un nom de domaine, mis en minuscules", () => {
    expect(logoHost("MindMup.com")).toBe("mindmup.com");
    expect(logoHost("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
  });

  it("refuse ce qui n'est pas un nom de domaine à point", () => {
    for (const raw of ["", "localhost", "../etc/passwd", "a/b.com", "exemple..org", "-x.org", "x-.org", "127.0.0.1:80", "[::1]", "x.org.", "é.org"]) {
      expect(logoHost(raw), raw).toBeNull();
    }
    expect(logoHost(`${"a".repeat(250)}.org`)).toBeNull();
  });
});

describe("logoTarget", () => {
  const sites = ["https://www.mindmup.com/", "https://excalidraw.com/", null, "https://docs.google.com/forms/d/123"];

  it("rend la page d'accueil du site de la base qui porte cet hôte, www compris", () => {
    expect(logoTarget("mindmup.com", sites)).toBe("https://www.mindmup.com/");
    expect(logoTarget("docs.google.com", sites)).toBe("https://docs.google.com/");
  });

  it("refuse un hôte absent de la base", () => {
    expect(logoTarget("example.org", sites)).toBeNull();
    expect(logoTarget("www.mindmup.com", sites)).toBeNull();
    expect(logoTarget("mindmup.com", [])).toBeNull();
  });
});

describe("logoCandidates", () => {
  const page = "https://www.exemple.org/accueil/";

  it("met l'apple-touch-icon en tête, puis l'icône la plus grande, puis /favicon.ico", () => {
    const html = `<head>
      <link rel="icon" href="/f16.png" sizes="16x16">
      <link rel="shortcut icon" href="/f.ico">
      <link rel="icon" href="/f192.png" sizes="192x192">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="f32.png" sizes="32x32 16x16">
    </head>`;
    expect(logoCandidates(html, page)).toEqual([
      "https://www.exemple.org/apple.png",
      "https://www.exemple.org/f192.png",
      "https://www.exemple.org/accueil/f32.png",
      "https://www.exemple.org/f16.png",
      "https://www.exemple.org/f.ico",
      "https://www.exemple.org/favicon.ico",
    ]);
  });

  it("classe les apple-touch-icon entre eux par taille", () => {
    const html = `<link rel="apple-touch-icon" sizes="76x76" href="/a76.png"><link rel="apple-touch-icon-precomposed" sizes="180x180" href="/a180.png">`;
    expect(logoCandidates(html, page).slice(0, 2)).toEqual(["https://www.exemple.org/a180.png", "https://www.exemple.org/a76.png"]);
  });

  it("écarte SVG, mask-icon et adresses hors http(s), sans doublon", () => {
    const html = `
      <link rel="icon" type="image/svg+xml" href="/logo.svg" sizes="any">
      <link rel="icon" href="/autre.SVG?v=2">
      <link rel="mask-icon" href="/mask.png">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="/favicon.ico">
      <link rel="stylesheet" href="/style.css">`;
    expect(logoCandidates(html, page)).toEqual(["https://www.exemple.org/favicon.ico"]);
  });

  it("retombe sur /favicon.ico seul pour une page sans icône déclarée ou illisible", () => {
    expect(logoCandidates("", "https://exemple.org/a/b")).toEqual(["https://exemple.org/favicon.ico"]);
    expect(logoCandidates("<html><body>rien</body></html>", page)).toEqual(["https://www.exemple.org/favicon.ico"]);
  });

  it("décode les entités d'une adresse", () => {
    expect(logoCandidates(`<link rel="icon" href="/i.png?a=1&amp;b=2">`, page)[0]).toBe("https://www.exemple.org/i.png?a=1&b=2");
  });
});

describe("logoFresh", () => {
  it("garde un fichier moins de 30 jours", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(logoFresh(now - LOGO_FRESH_MS + 1000, now)).toBe(true);
    expect(logoFresh(now - LOGO_FRESH_MS - 1000, now)).toBe(false);
  });
});
