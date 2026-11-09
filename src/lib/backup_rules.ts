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

export type BackupKind = "daily" | "update" | "server";
export type BackupName = { kind: BackupKind; commit: string | null; at: Date };

// quotidienne_AAAAMMJJ_HHMM.dmp, avant_maj_<commit court>_AAAAMMJJ_HHMM.dmp,
// serveur_AAAAMMJJ_HHMM.dmp (copie du dump nocturne du VPS, datée du dump).
// L'heure est celle du Mac, qui sert l'app : lue en local.
// Un .partiel (dump interrompu) ne passe jamais pour une sauvegarde.
const NAME = /^(quotidienne|serveur|avant_maj_([0-9a-f]{7,40}))_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\.dmp$/;
const KIND_OF_PREFIX: Record<string, BackupKind> = { quotidienne: "daily", serveur: "server" };

export function parseBackupName(name: string): BackupName | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, prefix, commit, year, month, day, hour, minute] = match;
  const at = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  // new Date corrige en silence un 31 novembre ou un 25 h : refusé ici.
  if (at.getMonth() !== Number(month) - 1 || at.getDate() !== Number(day) || at.getHours() !== Number(hour) || at.getMinutes() !== Number(minute)) {
    return null;
  }
  return { kind: KIND_OF_PREFIX[prefix] ?? "update", commit: commit ?? null, at };
}

// La plus récente d'abord, par la date du nom : l'ordre alphabétique rangerait
// les sauvegardes d'avant mise à jour par commit.
export function sortBackups<T extends { at: Date }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function backupMotive({ kind, commit }: Pick<BackupName, "kind" | "commit">): string {
  if (kind === "daily") return "Quotidienne";
  if (kind === "server") return "Copie du serveur";
  return `Avant mise à jour vers ${commit}`;
}

// Nombre gardé, toutes catégories confondues (quotidiennes, avant mise à jour,
// copies du serveur) : les plus anciennes s'effacent. Les dumps manuels
// d'avant migration ne portent pas ces noms et restent hors rotation.
// Appliqué par scripts/notion_lancer.sh (tourner_total) et lib/server_dump.ts.
export const BACKUPS_KEPT_TOTAL = 20;

// Sauvegardes au-delà du quota, la plus ancienne d'abord.
export function excessBackups<T extends { at: Date }>(entries: readonly T[], keep = BACKUPS_KEPT_TOTAL): T[] {
  return sortBackups(entries).slice(keep);
}

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
// la dernière copie du serveur dans une base jetable, une fois par semaine.
export const TRIAL_DAYS = 7;

// Source : le dump du lanceur (mac) ou la copie du dump du serveur (serveur).
// pages : le compte relu après restauration, absent en cas d'échec.
export type TrialSource = "mac" | "serveur";
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

// « miroir » : nom d'avant le palier (f), quand miroir.sh rapatriait le dump du
// serveur ; relu comme la copie qui l'a remplacé.
const SOURCES: Record<string, TrialSource> = { mac: "mac", serveur: "serveur", miroir: "serveur" };

const isTrialResult = (value: unknown): value is TrialResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { source, file, ok, pages, error } = value as Record<string, unknown>;
  if (typeof source !== "string" || !Object.hasOwn(SOURCES, source)) return false;
  if (typeof file !== "string" || typeof ok !== "boolean") return false;
  if (pages !== undefined && (typeof pages !== "number" || !Number.isInteger(pages) || pages < 0)) return false;
  return error === undefined || typeof error === "string";
};

export function parseBackupTrial(value: unknown): BackupTrial | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { at, results } = value as Record<string, unknown>;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  if (!Array.isArray(results) || !results.every(isTrialResult)) return null;
  return { at, results: results.map((result) => ({ ...result, source: SOURCES[result.source] })) };
}

// --- Copie du serveur (palier f) ---------------------------------------------

// L'app Mac recopie le dump nocturne du VPS dans ses sauvegardes, app ouverte
// seulement. Une copie est due 20 h après la date de la dernière, qui est celle
// du dump : le dump étant quotidien, un second lancement le même jour ne
// recopie rien. Trois jours sans copie récente alertent : le Mac ne copie plus,
// ou le serveur ne fait plus ses dumps.
export const SERVER_COPY_DUE_HOURS = 20;
export const SERVER_COPY_LATE_DAYS = 3;
const HOUR_MS = 60 * 60 * 1000;

// Nom Coolify : pg-dump-<base>-<époque en secondes>-<id>.dmp. null si le nom ne
// porte pas d'époque lisible : la copie se date alors de l'heure de la copie.
const COOLIFY_NAME = /-(\d{9,11})-[A-Za-z0-9]+\.dmp$/;

export function serverDumpDate(remoteName: string): Date | null {
  const match = COOLIFY_NAME.exec(remoteName);
  return match ? new Date(Number(match[1]) * 1000) : null;
}

export function serverCopyName(at: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  return `serveur_${day}_${two(at.getHours())}${two(at.getMinutes())}.dmp`;
}

export function serverCopyDue(newest: Date | null, nowMs: number): boolean {
  return !newest || nowMs - newest.getTime() >= SERVER_COPY_DUE_HOURS * HOUR_MS;
}

// Dernière tentative, gardée dans backup.server : copiée et relue, illisible
// (copiée mais pas relue, donc effacée), ou ratée avant la copie (VPS
// injoignable, aucun dump). remote : le nom du dump sur le serveur.
export type ServerCopyResult = "copied" | "unreadable" | "failed";
export type ServerCopy = { at: string; remote: string | null; result: ServerCopyResult; error?: string };

const COPY_RESULTS = new Set<string>(["copied", "unreadable", "failed"]);

export function parseServerCopy(value: unknown): ServerCopy | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { at, remote, result, error } = value as Record<string, unknown>;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  if (remote !== null && typeof remote !== "string") return null;
  if (typeof result !== "string" || !COPY_RESULTS.has(result)) return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { at, remote, result: result as ServerCopyResult, ...(error === undefined ? {} : { error }) };
}

// Alerte de la ligne d'état. Une copie illisible est le même risque qu'un dump
// qui ne se relit pas ; « en retard » se mesure sur la date de la dernière
// copie gardée. Aucune tentative encore (copie non réglée) : rien.
export function serverCopyAlert(copy: ServerCopy | null, newest: Date | null, nowMs: number): "unreadable" | "late" | null {
  if (!copy) return null;
  if (copy.result === "unreadable") return "unreadable";
  if (!newest || nowMs - newest.getTime() >= SERVER_COPY_LATE_DAYS * 24 * HOUR_MS) return "late";
  return null;
}
