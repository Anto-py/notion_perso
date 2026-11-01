// Sauvegardes de la base locale, côté serveur du Mac : le lanceur les écrit
// dans BACKUP_DIR (scripts/notion_lancer.sh), le serveur les liste et les
// ouvre en lecture seule (palier d de l'étape 12).
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { backupConnectionString, backupDbName, closeBackupDb } from "./backup_db";
import {
  parseBackupAlert,
  parseBackupName,
  sortBackups,
  type BackupAlert,
  type BackupName,
  type OpenBackup,
} from "./backup_rules";
import { getSetting, setSetting } from "./settings";

export type BackupEntry = BackupName & { name: string; size: number };

const run = promisify(execFile);

// Un dump de 250 Mo se restaure en dizaines de secondes ; la marge couvre un
// disque lent sans laisser un clic pendu indéfiniment.
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

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

// --- Ouvrir une sauvegarde (palier d) ----------------------------------------

async function tool(name: string, args: string[]): Promise<void> {
  await run(name, args, { timeout: BACKUP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
}

// Posé par le lanceur : Postgres.app se trouve alors dans le PATH.
function requireMacPaths(): { dir: string; dbName: string; connectionString: string } {
  const dir = backupDir();
  const dbName = backupDbName();
  const connectionString = backupConnectionString();
  if (!dir || !dbName || !connectionString) {
    throw new Error("Ouverture d'une sauvegarde réservée à l'app Mac : BACKUP_DIR ou DATABASE_URL manque");
  }
  return { dir, dbName, connectionString };
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file).then((info) => info.isFile(), () => false);
}

// Mise à niveau de la copie, jamais du fichier : une sauvegarde d'un schéma
// plus ancien s'ouvre quand même. La copie garde sa table des migrations.
async function upgradeCopy(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "src/db/migrations"),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// Un dump à la fois : la copie précédente est déposée avant d'être refaite.
// Échec en route : la copie partielle est effacée et rien n'est noté, la base
// vive n'ayant jamais été touchée.
export async function openBackup(name: string): Promise<OpenBackup> {
  const { dir, dbName, connectionString } = requireMacPaths();
  if (!parseBackupName(name)) throw new Error("Ce fichier n'est pas une sauvegarde");
  const file = path.join(/*turbopackIgnore: true*/ dir, name);
  if (!(await fileExists(file))) throw new Error("Sauvegarde introuvable sur le disque");

  await closeBackupDb();
  await tool("dropdb", ["--if-exists", "--force", dbName]);
  try {
    await tool("createdb", [dbName]);
    await tool("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "-d", dbName, file]);
    await upgradeCopy(connectionString);
  } catch (error) {
    await tool("dropdb", ["--if-exists", "--force", dbName]).catch(() => undefined);
    await setSetting("backup.open", null).catch(() => undefined);
    throw error;
  }
  const open: OpenBackup = { name, at: new Date().toISOString() };
  await setSetting("backup.open", open);
  return open;
}

// Fermer dépose la copie : elle se refait à la demande depuis le dump, qui
// reste intact.
export async function closeBackup(): Promise<void> {
  const dbName = backupDbName();
  await closeBackupDb();
  if (dbName) await tool("dropdb", ["--if-exists", "--force", dbName]).catch(() => undefined);
  await setSetting("backup.open", null);
}

// La sauvegarde ouverte, si son fichier est encore là. La rotation du lanceur
// peut l'avoir effacée entre deux lancements : la clé s'efface alors aussi.
export async function readOpenBackup(): Promise<OpenBackup | null> {
  const open = await getSetting("backup.open");
  if (!open) return null;
  const dir = backupDir();
  if (!dir || !(await fileExists(path.join(/*turbopackIgnore: true*/ dir, open.name)))) {
    await setSetting("backup.open", null);
    return null;
  }
  return open;
}
