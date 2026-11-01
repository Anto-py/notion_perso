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

  it("écart de version : redémarrer, le message du serveur au survol", () => {
    const error = "Schéma différent (serveur 2, Mac 1). Redémarrez l'app Mac pour la mettre à jour.";
    expect(line({ error, reason: "version", pending: 3 })).toEqual({
      tone: "error",
      text: "⚠ Redémarrer pour mettre à jour",
      title: error,
    });
    // Le motif seul, sans erreur notée (cycle réussi depuis), ne dit rien.
    expect(line({ reason: "version" })).toEqual({ tone: "calm", text: "✓ Synchronisé 14:05" });
  });

  it("jamais synchronisé, rien en attente", () => {
    expect(line({ syncedAt: null })).toEqual({ tone: "pending", text: "↻ Pas encore synchronisé" });
  });
});

describe("syncLine, suspension", () => {
  const at = "2026-11-01T10:00:00.000Z";
  const auto = (kinds: { trashed: number; emptied: number; purged: number }, direction: "up" | "down" = "down") => ({
    at,
    by: "auto" as const,
    direction,
    count: kinds.trashed + kinds.emptied + kinds.purged,
    kinds,
    titles: [],
  });

  it("manuelle : le nombre en attente, rien quand rien n'attend", () => {
    expect(line({ suspended: { at, by: "manual" }, pending: 3 })).toMatchObject({
      tone: "suspended",
      text: "⏸ Synchronisation suspendue · 3 en attente",
    });
    expect(line({ suspended: { at, by: "manual" } }).text).toBe("⏸ Synchronisation suspendue");
  });

  it("automatique : le nombre, le geste seul en cause et le côté du lot", () => {
    expect(line({ suspended: auto({ trashed: 0, emptied: 0, purged: 1638 }) }).text).toBe(
      "⏸ Suspendue : 1638 pages purgées sur le serveur",
    );
    expect(line({ suspended: auto({ trashed: 50, emptied: 0, purged: 0 }, "up") }).text).toBe(
      "⏸ Suspendue : 50 pages mises en corbeille sur le Mac",
    );
    expect(line({ suspended: auto({ trashed: 10, emptied: 15, purged: 0 }, "up") }).text).toBe(
      "⏸ Suspendue : 25 pages abîmées sur le Mac",
    );
  });

  it("passe devant l'erreur, le conflit et le hors ligne, qu'elle rend caducs", () => {
    const suspended = { at, by: "manual" as const };
    expect(line({ suspended, error: "Serveur injoignable", reason: "offline" }).tone).toBe("suspended");
    expect(line({ suspended, conflicts: 2 }).tone).toBe("suspended");
    expect(line({ suspended, online: false }).tone).toBe("suspended");
  });
});

describe("syncLine, sauvegardes", () => {
  it("dit une mise à jour reportée et une quotidienne ratée", () => {
    expect(line({ backupAlert: "update_deferred" })).toMatchObject({
      tone: "backup",
      text: "⚠ Mise à jour reportée : sauvegarde impossible",
    });
    expect(line({ backupAlert: "daily_failed" })).toMatchObject({
      tone: "backup",
      text: "⚠ Sauvegarde du jour impossible",
    });
  });

  it("après la suspension, avant l'erreur, le conflit et le hors ligne", () => {
    const backupAlert = "daily_failed" as const;
    expect(line({ backupAlert, suspended: { at: "2026-11-01T10:00:00.000Z", by: "manual" } }).tone).toBe("suspended");
    expect(line({ backupAlert, error: "Serveur injoignable", reason: "server" }).tone).toBe("backup");
    expect(line({ backupAlert, error: "Commit refusé", reason: "version" }).tone).toBe("backup");
    expect(line({ backupAlert, conflicts: 2 }).tone).toBe("backup");
    expect(line({ backupAlert, online: false }).tone).toBe("backup");
    expect(line({ backupAlert: null }).tone).toBe("calm");
  });
});
