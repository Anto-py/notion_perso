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

// --- Ouvrir une sauvegarde (palier d) ---------------------------------------

// Une sauvegarde restaurée vit dans une base à part, dérivée du nom de la base
// vive : notion_perso_local donne notion_perso_local_sauvegarde. null pour une
// URL illisible ou un nom qui ne peut pas être un identifiant PostgreSQL.
const DB_NAME = /^[A-Za-z0-9_]{1,52}$/;

export function databaseName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
    return DB_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function backupDatabaseName(databaseUrl: string | undefined): string | null {
  const name = databaseName(databaseUrl);
  return name ? `${name}_sauvegarde` : null;
}

// Base jetable où tourne la restauration d'essai (palier e), effacée après.
export function trialDatabaseName(databaseUrl: string | undefined): string | null {
  const name = databaseName(databaseUrl);
  return name ? `${name}_essai` : null;
}

// La sauvegarde ouverte, gardée dans le réglage backup.open : le nom du dump
// et la date de l'ouverture. Une forme inattendue vaut fermée.
export type OpenBackup = { name: string; at: string };

export function parseOpenBackup(value: unknown): OpenBackup | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { name, at } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof at !== "string" || !parseBackupName(name)) return null;
  return Number.isNaN(Date.parse(at)) ? null : { name, at };
}

// --- Restauration d'essai (palier e) -----------------------------------------

// Une sauvegarde jamais relue n'est qu'un espoir : le Mac restaure la sienne et
// le dernier dump du miroir dans une base jetable, une fois par semaine.
export const TRIAL_DAYS = 7;

// Source : le dump du lanceur (mac) ou celui que miroir.sh rapatrie (miroir).
// pages : le compte relu après restauration, absent en cas d'échec.
export type TrialSource = "mac" | "miroir";
export type TrialResult = { source: TrialSource; file: string; ok: boolean; pages?: number; error?: string };
export type BackupTrial = { at: string; results: TrialResult[] };

// Un essai est dû une semaine après le précédent, ou tout de suite s'il n'y en
// a jamais eu.
export function trialDue(trial: BackupTrial | null, nowMs: number): boolean {
  if (!trial) return true;
  const at = Date.parse(trial.at);
  return Number.isNaN(at) || nowMs - at >= TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

// L'alerte dure jusqu'à un essai réussi : une source absente n'est pas un
// échec, seules les sources réellement éprouvées comptent.
export function trialFailed(trial: BackupTrial | null): boolean {
  return trial !== null && trial.results.some((result) => !result.ok);
}

const isTrialResult = (value: unknown): value is TrialResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { source, file, ok, pages, error } = value as Record<string, unknown>;
  if (source !== "mac" && source !== "miroir") return false;
  if (typeof file !== "string" || typeof ok !== "boolean") return false;
  if (pages !== undefined && (typeof pages !== "number" || !Number.isInteger(pages) || pages < 0)) return false;
  return error === undefined || typeof error === "string";
};

export function parseBackupTrial(value: unknown): BackupTrial | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { at, results } = value as Record<string, unknown>;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  if (!Array.isArray(results) || !results.every(isTrialResult)) return null;
  return { at, results };
}
