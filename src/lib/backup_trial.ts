// Restauration d'essai (palier e de l'étape 12) : une sauvegarde jamais relue
// n'est qu'un espoir. La dernière du Mac et le dernier dump du miroir sont
// restaurés tour à tour dans une base jetable, la table pages est relue, la
// base est effacée. Le résultat s'affiche dans Réglages › Sauvegardes ; un
// échec alerte dans la ligne d'état jusqu'au prochain essai réussi.
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { backupDbName, connectionStringFor } from "./backup_db";
import { trialDatabaseName, trialDue, type BackupTrial, type TrialResult, type TrialSource } from "./backup_rules";
import { backupDir, listBackups } from "./backups";
import { getSetting, setSetting } from "./settings";

const run = promisify(execFile);
const RESTORE_TIMEOUT_MS = 10 * 60 * 1000;

// Écrit par miroir.sh, à défaut le dossier par défaut du LaunchAgent.
function mirrorDumpDir(): string {
  const env = process.env.MIRROR_DUMP_DIR;
  return env ? path.resolve(/*turbopackIgnore: true*/ env) : path.join(/*turbopackIgnore: true*/ os.homedir(), "notion_perso_miroir", "dumps");
}

// Le .dmp le plus récent du miroir : son nom ne suit pas celui du lanceur.
async function latestMirrorDump(): Promise<{ file: string; fullPath: string } | null> {
  const dir = mirrorDumpDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  let best: { file: string; fullPath: string; mtimeMs: number } | null = null;
  for (const name of names) {
    if (!name.endsWith(".dmp")) continue;
    const fullPath = path.join(/*turbopackIgnore: true*/ dir, name);
    const info = await stat(fullPath).catch(() => null);
    if (!info?.isFile()) continue;
    if (!best || info.mtimeMs > best.mtimeMs) best = { file: name, fullPath, mtimeMs: info.mtimeMs };
  }
  return best ? { file: best.file, fullPath: best.fullPath } : null;
}

// Restaure un dump dans la base jetable, compte les pages, efface la base.
// Une base de zéro ligne est un échec : le dump s'est restauré sans rien.
async function restoreAndCount(dbName: string, fullPath: string): Promise<number> {
  const connectionString = connectionStringFor(dbName);
  if (!connectionString) throw new Error("DATABASE_URL manquante");
  await run("dropdb", ["--if-exists", "--force", dbName]).catch(() => undefined);
  await run("createdb", [dbName]);
  try {
    await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "-d", dbName, fullPath], {
      timeout: RESTORE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const pool = new Pool({ connectionString });
    try {
      const result = await pool.query<{ n: number }>("select count(*)::int as n from pages");
      return result.rows[0]?.n ?? 0;
    } finally {
      await pool.end().catch(() => undefined);
    }
  } finally {
    await run("dropdb", ["--if-exists", "--force", dbName]).catch(() => undefined);
  }
}

// Ce que pg_restore a dit, plutôt que la ligne de commande : le message
// complet d'execFile est « Command failed: pg_restore --no-owner … ».
function failureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const first = stderr.split("\n").find((line) => line.trim() && !line.includes("NOTICE"));
    if (first) return first.trim().slice(0, 200);
  }
  return error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "Restauration impossible";
}

async function attempt(source: TrialSource, file: string, fullPath: string, dbName: string): Promise<TrialResult> {
  try {
    const pages = await restoreAndCount(dbName, fullPath);
    if (pages <= 0) return { source, file, ok: false, error: "Dump restauré sans aucune page" };
    return { source, file, ok: true, pages };
  } catch (error) {
    return { source, file, ok: false, error: failureMessage(error) };
  }
}

// Les deux sources éprouvées, l'une après l'autre. Une source absente n'est pas
// un échec : elle n'entre pas dans le résultat, sans quoi l'app alerterait
// avant la première sauvegarde ou après le retrait du miroir.
export async function runTrial(): Promise<BackupTrial> {
  const dbName = trialDatabaseName(process.env.DATABASE_URL);
  if (!dbName) throw new Error("Restauration d'essai réservée à l'app Mac : DATABASE_URL manquante");

  const results: TrialResult[] = [];
  const dir = backupDir();
  const latest = (await listBackups())[0];
  if (dir && latest) {
    results.push(await attempt("mac", latest.name, path.join(/*turbopackIgnore: true*/ dir, latest.name), dbName));
  }
  const mirror = await latestMirrorDump();
  if (mirror) results.push(await attempt("miroir", mirror.file, mirror.fullPath, dbName));

  const trial: BackupTrial = { at: new Date().toISOString(), results };
  await setSetting("backup.trial", trial);
  return trial;
}

// Au démarrage, une minute après : l'essai ne retarde pas le service. Rien sur
// le VPS, où BACKUP_DIR n'existe pas.
export async function runTrialIfDue(): Promise<BackupTrial | null> {
  if (!backupDir() || !backupDbName()) return null;
  const previous = await getSetting("backup.trial");
  if (!trialDue(previous, Date.now())) return null;
  return runTrial();
}

