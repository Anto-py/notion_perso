// Restauration d'essai (palier e de l'étape 12) : une sauvegarde jamais relue
// n'est qu'un espoir. La dernière du Mac et la dernière copie du serveur
// (palier f) sont restaurées tour à tour dans une base jetable, la table pages
// est relue, la base est effacée. Le résultat s'affiche dans Réglages ›
// Sauvegardes ; un échec alerte dans la ligne d'état jusqu'au prochain essai
// réussi. La copie du serveur passe par la même relecture avant d'être gardée.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { backupDbName, connectionStringFor } from "./backup_db";
import { trialDatabaseName, trialDue, type BackupTrial, type TrialResult, type TrialSource } from "./backup_rules";
import { backupDir, listBackups } from "./backups";
import { getSetting, setSetting } from "./settings";

const run = promisify(execFile);
const RESTORE_TIMEOUT_MS = 10 * 60 * 1000;

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

// Une restauration à la fois dans la base jetable : l'essai hebdomadaire et la
// relecture d'une copie du serveur se la partagent. File sur globalThis, le
// module étant chargé deux fois (instrumentation.ts et les routes).
const shared = globalThis as typeof globalThis & { __trialDbQueue?: Promise<unknown> };

function inTrialDb<T>(task: (dbName: string) => Promise<T>): Promise<T> {
  const dbName = trialDatabaseName(process.env.DATABASE_URL);
  if (!dbName) return Promise.reject(new Error("Restauration d'essai réservée à l'app Mac : DATABASE_URL manquante"));
  const next = (shared.__trialDbQueue ?? Promise.resolve()).catch(() => undefined).then(() => task(dbName));
  shared.__trialDbQueue = next.catch(() => undefined);
  return next;
}

export type DumpCheck = { ok: true; pages: number } | { ok: false; error: string };

// Restaure un dump dans la base jetable et compte ses pages.
export async function checkDump(fullPath: string): Promise<DumpCheck> {
  try {
    const pages = await inTrialDb((dbName) => restoreAndCount(dbName, fullPath));
    return pages > 0 ? { ok: true, pages } : { ok: false, error: "Dump restauré sans aucune page" };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// Ce que l'outil a dit, plutôt que la ligne de commande : le message complet
// d'execFile est « Command failed: pg_restore --no-owner … ».
export function failureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const first = stderr.split("\n").find((line) => line.trim() && !line.includes("NOTICE"));
    if (first) return first.trim().slice(0, 200);
  }
  return error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "Restauration impossible";
}

async function attempt(source: TrialSource, dir: string, file: string): Promise<TrialResult> {
  const check = await checkDump(path.join(/*turbopackIgnore: true*/ dir, file));
  return check.ok ? { source, file, ok: true, pages: check.pages } : { source, file, ok: false, error: check.error };
}

// Les deux sources éprouvées, l'une après l'autre : la dernière sauvegarde du
// Mac, la dernière copie du serveur. Une source absente n'est pas un échec :
// elle n'entre pas dans le résultat, sans quoi l'app alerterait avant la
// première sauvegarde, ou tant que la copie du serveur n'est pas réglée.
export async function runTrial(): Promise<BackupTrial> {
  if (!trialDatabaseName(process.env.DATABASE_URL)) throw new Error("Restauration d'essai réservée à l'app Mac : DATABASE_URL manquante");

  const results: TrialResult[] = [];
  const dir = backupDir();
  const backups = await listBackups();
  const mac = backups.find((backup) => backup.kind !== "server");
  const server = backups.find((backup) => backup.kind === "server");
  if (dir && mac) results.push(await attempt("mac", dir, mac.name));
  if (dir && server) results.push(await attempt("serveur", dir, server.name));

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

