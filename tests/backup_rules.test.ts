import { describe, expect, it } from "vitest";
import {
  backupMotive,
  parseBackupAlert,
  parseBackupName,
  QUARANTINE_DAYS,
  quarantineExpired,
  sortBackups,
} from "../src/lib/backup_rules";

describe("parseBackupName", () => {
  it("lit une quotidienne", () => {
    expect(parseBackupName("quotidienne_20261101_0912.dmp")).toEqual({
      kind: "daily",
      commit: null,
      at: new Date(2026, 10, 1, 9, 12),
    });
  });

  it("lit une sauvegarde d'avant mise à jour et son commit", () => {
    expect(parseBackupName("avant_maj_abc1234_20261031_2359.dmp")).toEqual({
      kind: "update",
      commit: "abc1234",
      at: new Date(2026, 9, 31, 23, 59),
    });
  });

  it("refuse un dump interrompu, un autre fichier ou une date impossible", () => {
    expect(parseBackupName("quotidienne_20261101_0912.dmp.partiel")).toBeNull();
    expect(parseBackupName("quotidienne_20261101_0912.sql")).toBeNull();
    expect(parseBackupName("notes.dmp")).toBeNull();
    expect(parseBackupName("quotidienne_20261341_0912.dmp")).toBeNull();
    expect(parseBackupName("quotidienne_20261101_2560.dmp")).toBeNull();
    expect(parseBackupName("avant_maj_ABC_20261101_0912.dmp")).toBeNull();
  });
});

describe("sortBackups", () => {
  it("range de la plus récente à la plus ancienne, par la date et non par le commit", () => {
    const names = [
      "avant_maj_fff0000_20261030_1000.dmp",
      "quotidienne_20261101_0800.dmp",
      "avant_maj_aaa0000_20261101_0900.dmp",
    ];
    const entries = names.map((name) => ({ name, ...parseBackupName(name)! }));
    expect(sortBackups(entries).map((e) => e.name)).toEqual([
      "avant_maj_aaa0000_20261101_0900.dmp",
      "quotidienne_20261101_0800.dmp",
      "avant_maj_fff0000_20261030_1000.dmp",
    ]);
  });
});

describe("backupMotive", () => {
  it("dit le motif de chaque sauvegarde", () => {
    expect(backupMotive({ kind: "daily", commit: null })).toBe("Quotidienne");
    expect(backupMotive({ kind: "update", commit: "abc1234" })).toBe("Avant mise à jour vers abc1234");
  });
});

describe("parseBackupAlert", () => {
  it("reconnaît les deux alertes du lanceur et ignore le reste", () => {
    expect(parseBackupAlert("update_deferred")).toBe("update_deferred");
    expect(parseBackupAlert(" daily_failed\n")).toBe("daily_failed");
    expect(parseBackupAlert("")).toBeNull();
    expect(parseBackupAlert(undefined)).toBeNull();
    expect(parseBackupAlert("autre")).toBeNull();
  });
});

describe("quarantineExpired", () => {
  const now = new Date(2026, 10, 1, 12, 0).getTime();
  const day = 24 * 60 * 60 * 1000;

  it("garde un fichier entré en quarantaine il y a moins de 30 jours", () => {
    expect(QUARANTINE_DAYS).toBe(30);
    expect(quarantineExpired(now - 29 * day, now)).toBe(false);
    expect(quarantineExpired(now - 30 * day + 1, now)).toBe(false);
  });

  it("efface au-delà de 30 jours", () => {
    expect(quarantineExpired(now - 30 * day, now)).toBe(true);
    expect(quarantineExpired(now - 400 * day, now)).toBe(true);
  });
});
