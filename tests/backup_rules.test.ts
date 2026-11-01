import { describe, expect, it } from "vitest";
import {
  backupDatabaseName,
  backupMotive,
  parseBackupAlert,
  parseBackupName,
  parseBackupTrial,
  parseOpenBackup,
  QUARANTINE_DAYS,
  quarantineExpired,
  sortBackups,
  TRIAL_DAYS,
  trialDatabaseName,
  trialDue,
  trialFailed,
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

describe("backupDatabaseName", () => {
  it("dérive le nom de la base de sauvegarde du nom de la base vive", () => {
    expect(backupDatabaseName("postgres://antonin@localhost:5432/notion_perso_local")).toBe("notion_perso_local_sauvegarde");
    expect(backupDatabaseName("postgres://u:p@h:5432/notion_perso_dev?sslmode=disable")).toBe("notion_perso_dev_sauvegarde");
  });

  it("refuse une URL absente ou un nom qui ne peut pas être un identifiant", () => {
    expect(backupDatabaseName(undefined)).toBeNull();
    expect(backupDatabaseName("pas une url")).toBeNull();
    expect(backupDatabaseName("postgres://localhost:5432/")).toBeNull();
    expect(backupDatabaseName("postgres://localhost:5432/nom-invalide")).toBeNull();
    expect(backupDatabaseName(`postgres://localhost:5432/${"x".repeat(53)}`)).toBeNull();
  });
});

describe("parseOpenBackup", () => {
  const name = "quotidienne_20261101_0912.dmp";

  it("lit une sauvegarde ouverte", () => {
    expect(parseOpenBackup({ name, at: "2026-11-01T09:20:00.000Z" })).toEqual({ name, at: "2026-11-01T09:20:00.000Z" });
  });

  it("refuse un nom qui n'est pas un dump, une date illisible ou une autre forme", () => {
    expect(parseOpenBackup({ name: "notes.dmp", at: "2026-11-01T09:20:00.000Z" })).toBeNull();
    expect(parseOpenBackup({ name, at: "hier" })).toBeNull();
    expect(parseOpenBackup({ name })).toBeNull();
    expect(parseOpenBackup("quotidienne_20261101_0912.dmp")).toBeNull();
    expect(parseOpenBackup(null)).toBeNull();
  });
});

describe("trialDatabaseName", () => {
  it("suffixe le nom de la base vive par _essai", () => {
    expect(trialDatabaseName("postgres://antonin@localhost:5432/notion_perso_local")).toBe("notion_perso_local_essai");
    expect(trialDatabaseName(undefined)).toBeNull();
    expect(trialDatabaseName("pas une url")).toBeNull();
  });
});

describe("restauration d'essai", () => {
  const now = new Date("2026-11-08T12:00:00Z").getTime();
  const trial = (at: string, ok = true) => ({
    at,
    results: [{ source: "mac" as const, file: "quotidienne_20261101_0912.dmp", ok, ...(ok ? { pages: 42 } : { error: "pg_restore a échoué" }) }],
  });

  it("dit l'essai dû une semaine après le précédent, ou s'il n'y en a jamais eu", () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(trialDue(null, now)).toBe(true);
    expect(trialDue(trial("2026-11-01T12:00:00Z"), now)).toBe(true);
    expect(trialDue(trial("2026-11-02T12:00:00Z"), now)).toBe(false);
    expect(trialDue(trial("pas une date"), now)).toBe(true);
  });

  it("alerte tant qu'un essai a échoué, et se taît sur une source absente", () => {
    expect(trialFailed(null)).toBe(false);
    expect(trialFailed(trial("2026-11-01T12:00:00Z", true))).toBe(false);
    expect(trialFailed(trial("2026-11-01T12:00:00Z", false))).toBe(true);
    expect(trialFailed({ at: "2026-11-01T12:00:00Z", results: [] })).toBe(false);
  });

  it("relit un essai enregistré, et refuse une forme inattendue", () => {
    const saved = trial("2026-11-01T12:00:00Z");
    expect(parseBackupTrial(saved)).toEqual(saved);
    expect(parseBackupTrial({ ...saved, at: "hier" })).toBeNull();
    expect(parseBackupTrial({ ...saved, results: [{ source: "autre", file: "x", ok: true }] })).toBeNull();
    expect(parseBackupTrial({ ...saved, results: [{ source: "mac", file: "x", ok: "oui" }] })).toBeNull();
    expect(parseBackupTrial({ ...saved, results: [{ source: "mac", file: "x", ok: true, pages: -1 }] })).toBeNull();
    expect(parseBackupTrial("essai")).toBeNull();
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
