// Sauvegardes de la base locale du Mac (SPECS.md, « Réglages, sauvegardes et
// suspension ») : le lanceur fait les dumps et les nomme, le serveur les lit.
// Pur : ni disque ni horloge, tout est fourni.

// Alerte posée par le lanceur dans BACKUP_ALERT : dump d'avant mise à jour
// raté (la version courante a démarré à la place) ou quotidienne ratée.
export type BackupAlert = "update_deferred" | "daily_failed";

export function parseBackupAlert(value: string | undefined): BackupAlert | null {
  const alert = value?.trim();
  return alert === "update_deferred" || alert === "daily_failed" ? alert : null;
}

export type BackupKind = "daily" | "update";
export type BackupName = { kind: BackupKind; commit: string | null; at: Date };

// quotidienne_AAAAMMJJ_HHMM.dmp, avant_maj_<commit court>_AAAAMMJJ_HHMM.dmp.
// L'heure est celle du Mac, qui fait le dump et sert l'app : lue en local.
// Un .partiel (dump interrompu) ne passe jamais pour une sauvegarde.
const NAME = /^(?:quotidienne|avant_maj_([0-9a-f]{7,40}))_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\.dmp$/;

export function parseBackupName(name: string): BackupName | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, commit, year, month, day, hour, minute] = match;
  const at = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  // new Date corrige en silence un 31 novembre ou un 25 h : refusé ici.
  if (at.getMonth() !== Number(month) - 1 || at.getDate() !== Number(day) || at.getHours() !== Number(hour) || at.getMinutes() !== Number(minute)) {
    return null;
  }
  return { kind: commit ? "update" : "daily", commit: commit ?? null, at };
}

// La plus récente d'abord, par la date du nom : l'ordre alphabétique rangerait
// les sauvegardes d'avant mise à jour par commit.
export function sortBackups<T extends { at: Date }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function backupMotive({ kind, commit }: Pick<BackupName, "kind" | "commit">): string {
  return kind === "daily" ? "Quotidienne" : `Avant mise à jour vers ${commit}`;
}

// Nombre gardé par le lanceur (rotation dans scripts/notion_lancer.sh).
export const BACKUPS_KEPT = { daily: 7, update: 3 } as const;

// Un média effacé par la synchronisation ou le nettoyage passe 30 jours en
// quarantaine, pour qu'une page reprise d'une sauvegarde retrouve ses images.
// mtimeMs : date d'entrée en quarantaine (posée par removeFile).
export const QUARANTINE_DAYS = 30;

export function quarantineExpired(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs >= QUARANTINE_DAYS * 24 * 60 * 60 * 1000;
}
