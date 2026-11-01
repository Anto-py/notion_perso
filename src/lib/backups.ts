// Sauvegardes de la base locale, côté serveur du Mac : le lanceur les écrit
// dans BACKUP_DIR (scripts/notion_lancer.sh), le serveur les liste. Ouvrir
// une sauvegarde et y récupérer une page : palier (d) de l'étape 12.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseBackupAlert, parseBackupName, sortBackups, type BackupAlert, type BackupName } from "./backup_rules";

export type BackupEntry = BackupName & { name: string; size: number };

// null hors du lanceur (VPS, développement) : pas de section à remplir.
export function backupDir(): string | null {
  const dir = process.env.BACKUP_DIR;
  return dir ? path.resolve(/*turbopackIgnore: true*/ dir) : null;
}

export function backupAlert(): BackupAlert | null {
  return parseBackupAlert(process.env.BACKUP_ALERT);
}

// Les sauvegardes du dossier, la plus récente d'abord ; un dossier absent
// (aucun dump encore fait) donne une liste vide.
export async function listBackups(): Promise<BackupEntry[]> {
  const dir = backupDir();
  if (!dir) return [];
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: BackupEntry[] = [];
  for (const name of names) {
    const parsed = parseBackupName(name);
    if (!parsed) continue;
    const info = await stat(path.join(/*turbopackIgnore: true*/ dir, name)).catch(() => null);
    if (info?.isFile()) entries.push({ ...parsed, name, size: info.size });
  }
  return sortBackups(entries);
}
