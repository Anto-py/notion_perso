import { describe, expect, it } from "vitest";
import { MEDIA_RETENTION_DAYS, planCleanup, storedNamesIn, type MediaState } from "@/lib/media_cleanup";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-31T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const row = (filename: string, unusedSince: Date | null = null): MediaState => ({ id: `m_${filename}`, filename, unusedSince });

describe("storedNamesIn", () => {
  it("trouve les noms cités dans un corps BlockNote, sans doublon", () => {
    const body = JSON.stringify([
      { type: "image", props: { url: "/api/media/up_RlgisjEVdb-7ZAeO.jpg" } },
      { type: "file", props: { url: "/api/media/up_Gm5GAthmKgal5MAS.pdf", name: "cours.pdf" } },
      { type: "image", props: { url: "/api/media/up_RlgisjEVdb-7ZAeO.jpg" } },
    ]);
    expect(storedNamesIn(body).sort()).toEqual(["up_Gm5GAthmKgal5MAS.pdf", "up_RlgisjEVdb-7ZAeO.jpg"]);
  });

  it("ignore un nom trop court ou d'une extension non admise", () => {
    expect(storedNamesIn("up_court.png up_AbCdEfGhIjKlMnOp.svg up_AbCdEfGhIjKlMnOp.exe")).toEqual([]);
  });

  it("garde à tort un nom inclus dans un mot plus long : l'erreur va dans le sens sûr", () => {
    expect(storedNamesIn("setup_AbCdEfGhIjKlMnOp.png")).toEqual(["up_AbCdEfGhIjKlMnOp.png"]);
  });
});

describe("planCleanup", () => {
  it("marque un média devenu inutilisé, sans l'effacer", () => {
    const plan = planCleanup([row("a.png")], new Set(), NOW);
    expect(plan).toEqual({ mark: ["m_a.png"], unmark: [], remove: [] });
  });

  it("démarque un média de nouveau cité", () => {
    const plan = planCleanup([row("a.png", ago(10))], new Set(["a.png"]), NOW);
    expect(plan).toEqual({ mark: [], unmark: ["m_a.png"], remove: [] });
  });

  it("n'efface qu'au-delà du délai, limite comprise", () => {
    const rows = [row("jeune.png", ago(29)), row("limite.png", ago(30)), row("vieux.png", ago(45))];
    const plan = planCleanup(rows, new Set(), NOW);
    expect(plan.remove.map((r) => r.filename)).toEqual(["limite.png", "vieux.png"]);
    expect(plan.mark).toEqual([]);
  });

  it("ne touche ni à un média utilisé ni à un média déjà marqué dans le délai", () => {
    const plan = planCleanup([row("sert.png"), row("attend.png", ago(3))], new Set(["sert.png"]), NOW);
    expect(plan).toEqual({ mark: [], unmark: [], remove: [] });
  });

  it("vaut 30 jours par défaut", () => {
    expect(MEDIA_RETENTION_DAYS).toBe(30);
  });
});
