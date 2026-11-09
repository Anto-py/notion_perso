import { describe, expect, it } from "vitest";
import {
  backupDatabaseName,
  backupMotive,
  excessBackups,
  parseBackupAlert,
  parseBackupName,
  parseBackupTrial,
  parseOpenBackup,
  parseServerCopy,
  QUARANTINE_DAYS,
  quarantineExpired,
  serverCopyAlert,
  serverCopyDue,
  serverCopyName,
  serverDumpDate,
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

  it("lit une copie du serveur", () => {
    expect(parseBackupName("serveur_20261103_0200.dmp")).toEqual({ kind: "server", commit: null, at: new Date(2026, 10, 3, 2, 0) });
    expect(parseBackupName("serveur_20261103_0200.dmp.partiel")).toBeNull();
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

describe("excessBackups", () => {
  it("rend les plus anciennes au-delà de vingt, toutes catégories confondues", () => {
    const entries = Array.from({ length: 22 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 10, 1, 0, i)),
      name: `s${i}`,
    }));
    expect(excessBackups(entries).map((e) => e.name)).toEqual(["s1", "s0"]);
    expect(excessBackups(entries, 20)).toHaveLength(2);
  });

  it("ne rend rien tant que le quota n'est pas dépassé", () => {
    const entries = [{ at: new Date("2026-11-01T08:00:00Z"), name: "a" }];
    expect(excessBackups(entries)).toEqual([]);
  });
});

describe("backupMotive", () => {
  it("dit le motif de chaque sauvegarde", () => {
    expect(backupMotive({ kind: "daily", commit: null })).toBe("Quotidienne");
    expect(backupMotive({ kind: "update", commit: "abc1234" })).toBe("Avant mise à jour vers abc1234");
    expect(backupMotive({ kind: "server", commit: null })).toBe("Copie du serveur");
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

  it("relit un essai d'avant le palier (f) : le dump du miroir devient la copie du serveur", () => {
    const old = { at: "2026-11-01T12:00:00Z", results: [{ source: "miroir", file: "pg-dump-notion_perso-1793671218-f7ov.dmp", ok: true, pages: 9 }] };
    expect(parseBackupTrial(old)?.results[0].source).toBe("serveur");
  });
});

describe("copie du serveur", () => {
  const coolify = "pg-dump-notion_perso-1793671218-f7ovc29fuf1wakb70zjulczr.dmp";
  const hours = (count: number) => count * 60 * 60 * 1000;

  it("date la copie par l'époque du nom Coolify, à la minute, en heure du Mac", () => {
    expect(serverDumpDate(coolify)?.getTime()).toBe(1793671218 * 1000);
    expect(serverDumpDate("dump.dmp")).toBeNull();
    expect(serverDumpDate("pg-dump-notion_perso-12-abc.dmp")).toBeNull();
    const name = serverCopyName(serverDumpDate(coolify)!);
    expect(name).toMatch(/^serveur_\d{8}_\d{4}\.dmp$/);
    const parsed = parseBackupName(name)!;
    expect(parsed.kind).toBe("server");
    expect(1793671218 * 1000 - parsed.at.getTime()).toBeGreaterThanOrEqual(0);
    expect(1793671218 * 1000 - parsed.at.getTime()).toBeLessThan(60_000);
    expect(serverCopyName(new Date(2026, 0, 5, 7, 3))).toBe("serveur_20260105_0703.dmp");
  });

  it("copie 20 h après la date de la dernière copie, ou s'il n'y en a aucune", () => {
    const dumpedAt = new Date(2026, 10, 3, 2, 0);
    expect(serverCopyDue(null, dumpedAt.getTime())).toBe(true);
    expect(serverCopyDue(dumpedAt, dumpedAt.getTime() + hours(6))).toBe(false);
    expect(serverCopyDue(dumpedAt, dumpedAt.getTime() + hours(19))).toBe(false);
    expect(serverCopyDue(dumpedAt, dumpedAt.getTime() + hours(20))).toBe(true);
  });

  it("relit la dernière tentative, et refuse une forme inattendue", () => {
    const copied = { at: "2026-11-03T08:00:00.000Z", remote: coolify, result: "copied" };
    expect(parseServerCopy(copied)).toEqual(copied);
    const failed = { at: "2026-11-03T08:00:00.000Z", remote: null, result: "failed", error: "Serveur injoignable" };
    expect(parseServerCopy(failed)).toEqual(failed);
    expect(parseServerCopy({ ...copied, result: "peut-être" })).toBeNull();
    expect(parseServerCopy({ ...copied, at: "hier" })).toBeNull();
    expect(parseServerCopy({ ...copied, remote: 3 })).toBeNull();
    expect(parseServerCopy({ ...copied, error: 12 })).toBeNull();
    expect(parseServerCopy(null)).toBeNull();
  });

  it("alerte sur une copie illisible, ou trois jours sans copie récente, jamais avant la première tentative", () => {
    const newest = new Date(2026, 10, 3, 2, 0);
    const now = newest.getTime() + hours(30);
    const attempt = (result: "copied" | "unreadable" | "failed") => ({ at: new Date(now).toISOString(), remote: null, result });
    expect(serverCopyAlert(null, null, now)).toBeNull();
    expect(serverCopyAlert(attempt("copied"), newest, now)).toBeNull();
    expect(serverCopyAlert(attempt("failed"), newest, now)).toBeNull();
    expect(serverCopyAlert(attempt("unreadable"), newest, now)).toBe("unreadable");
    expect(serverCopyAlert(attempt("failed"), newest, newest.getTime() + hours(72))).toBe("late");
    expect(serverCopyAlert(attempt("failed"), null, now)).toBe("late");
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
