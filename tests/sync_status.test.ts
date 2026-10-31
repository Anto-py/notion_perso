import { describe, expect, it } from "vitest";
import { formatBytes, formatClock, progressLabel, syncLine, type SyncSnapshot } from "@/lib/sync_status";

const base: SyncSnapshot = {
  syncedAt: new Date("2026-10-31T13:05:00Z"),
  error: null,
  pending: 0,
  conflicts: 0,
  online: true,
};
const line = (patch: Partial<SyncSnapshot>) => syncLine({ ...base, ...patch });

describe("formatClock", () => {
  it("lit l'heure de Bruxelles, heure d'hiver comme heure d'été", () => {
    expect(formatClock(new Date("2026-10-31T13:05:00Z"))).toBe("14:05");
    expect(formatClock(new Date("2026-07-01T13:05:00Z"))).toBe("15:05");
  });
});

describe("formatBytes", () => {
  it("choisit l'unité et la décimale utiles", () => {
    expect(formatBytes(0)).toBe("0 o");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1024)).toBe("1 ko");
    expect(formatBytes(1536)).toBe("1,5 ko");
    expect(formatBytes(80 * 1024 * 1024)).toBe("80 Mo");
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe("1,2 Go");
  });
});

describe("progressLabel", () => {
  const mb = 1024 * 1024;
  const first = { first: true, pages: 640, pagesTotal: 1668, bytes: 80 * mb, bytesTotal: 257 * mb };

  it("annonce la première synchronisation, pages et médias", () => {
    expect(progressLabel(first)).toBe("Première synchronisation : 640 pages sur 1668, médias 80 Mo sur 257 Mo");
  });

  it("attend les totaux du premier lot", () => {
    expect(progressLabel({ ...first, pagesTotal: null, bytesTotal: null })).toBe("Première synchronisation…");
    expect(progressLabel({ ...first, bytesTotal: null })).toBe("Première synchronisation : 640 pages sur 1668");
  });

  it("une reprise après absence n'annonce pas de total", () => {
    expect(progressLabel({ ...first, first: false })).toBe("Synchronisation en cours…");
  });
});

describe("syncLine", () => {
  it("à jour : l'heure du dernier cycle", () => {
    expect(line({})).toEqual({ tone: "calm", text: "✓ Synchronisé 14:05" });
  });

  it("en attente, au singulier et au pluriel", () => {
    expect(line({ pending: 1 })).toEqual({ tone: "pending", text: "↻ 1 modification en attente" });
    expect(line({ pending: 3 })).toEqual({ tone: "pending", text: "↻ 3 modifications en attente" });
  });

  it("hors ligne : l'attente s'ajoute quand il y en a", () => {
    expect(line({ online: false })).toEqual({ tone: "offline", text: "⌁ Hors ligne" });
    expect(line({ online: false, pending: 2 })).toEqual({ tone: "offline", text: "⌁ Hors ligne · 2 en attente" });
  });

  it("conflits : le compte, au singulier et au pluriel", () => {
    expect(line({ conflicts: 1 })).toEqual({ tone: "conflict", text: "⚠ 1 conflit" });
    expect(line({ conflicts: 4 })).toEqual({ tone: "conflict", text: "⚠ 4 conflits" });
  });

  it("l'erreur passe avant tout, son message au survol", () => {
    expect(line({ error: "Jeton refusé", conflicts: 2, pending: 5 })).toEqual({
      tone: "error",
      text: "⚠ Synchronisation en échec",
      title: "Jeton refusé",
    });
  });

  it("jamais synchronisé, rien en attente", () => {
    expect(line({ syncedAt: null })).toEqual({ tone: "pending", text: "↻ Pas encore synchronisé" });
  });
});
