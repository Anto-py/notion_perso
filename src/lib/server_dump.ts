// Copie du serveur (palier f de l'étape 12, SPECS « Copie du serveur ») : l'app
// Mac recopie le dernier dump nocturne que Coolify laisse sur le VPS, le relit
// dans la base jetable de la restauration d'essai, et le range dans ses
// sauvegardes (vingt au total avec les autres), où il s'ouvre et se récupère
// comme les autres. App ouverte
// seulement : au démarrage, puis toutes les 6 h. Inerte sans BACKUP_DIR ni
// SERVER_DUMP_HOST (VPS, développement). Rien ne s'écrit sur le VPS : un ls et
// une copie, par la clé SSH posée dans app.conf.
import { execFile } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { excessBackups, serverCopyAlert, serverCopyDue, serverCopyName, serverDumpDate, type ServerCopy } from "./backup_rules";
import { checkDump, failureMessage } from "./backup_trial";
import { backupDir, listBackups, type BackupEntry } from "./backups";
import { getSetting, setSetting } from "./settings";

const run = promisify(execFile);
const EVERY_MS = 6 * 60 * 60 * 1000;
const LIST_TIMEOUT_MS = 60 * 1000;
const COPY_TIMEOUT_MS = 10 * 60 * 1000;
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

type Config = { dir: string; host: string; key: string; remoteDir: string };

// Le dossier distant entre dans une commande du shell distant, entre
// apostrophes : une apostrophe dans le réglage le rend inutilisable.
function config(): Config | null {
  const dir = backupDir();
  const { SERVER_DUMP_HOST: host, SERVER_DUMP_KEY: key, SERVER_DUMP_DIR: remoteDir } = process.env;
  if (!dir || !host || !key || !remoteDir || remoteDir.includes("'")) return null;
  return { dir, host, key: path.resolve(/*turbopackIgnore: true*/ key), remoteDir };
}

export function serverDumpConfigured(): boolean {
  return config() !== null;
}

async function serverCopies(): Promise<BackupEntry[]> {
  return (await listBackups()).filter((backup) => backup.kind === "server");
}

// Alerte de la ligne d'état : copie illisible, ou en retard.
export async function readServerCopyAlert(nowMs = Date.now()): Promise<"unreadable" | "late" | null> {
  if (!config()) return null;
  const [copy, copies] = await Promise.all([getSetting("backup.server"), serverCopies()]);
  return serverCopyAlert(copy, copies[0]?.at ?? null, nowMs);
}

// État sur globalThis : instrumentation.ts et les routes chargent ce module
// chacun de leur côté (piège du double chargement de module).
type LoopState = { timer?: NodeJS.Timeout; running?: Promise<ServerCopy | null> };
const shared = globalThis as typeof globalThis & { __serverDump?: LoopState };

export function startServerDumpLoop(): void {
  const state = (shared.__serverDump ??= {});
  if (state.timer || !config()) return;
  state.timer = setInterval(() => void copyServerDumpIfDue(), EVERY_MS);
  state.timer.unref();
  void copyServerDumpIfDue();
}

// Une copie à la fois : un second appel pendant la copie attend la même.
export function copyServerDumpIfDue(): Promise<ServerCopy | null> {
  const state = (shared.__serverDump ??= {});
  state.running ??= attemptCopy(Date.now())
    .catch((error: unknown) => {
      console.error("Copie du serveur impossible :", error);
      return null;
    })
    .finally(() => {
      state.running = undefined;
    });
  return state.running;
}

// null : rien à faire (copie non réglée, pas encore due, dump déjà copié).
async function attemptCopy(nowMs: number): Promise<ServerCopy | null> {
  const settings = config();
  if (!settings) return null;
  const { dir, host, key, remoteDir } = settings;
  if (!serverCopyDue((await serverCopies())[0]?.at ?? null, nowMs)) return null;
  const at = new Date(nowMs).toISOString();
  const record = async (copy: ServerCopy) => {
    await setSetting("backup.server", copy);
    return copy;
  };

  let remotePath: string;
  try {
    const listing = await run("ssh", ["-i", key, ...SSH_OPTIONS, host, `ls -1t '${remoteDir}'/*.dmp 2>/dev/null | head -1`], {
      timeout: LIST_TIMEOUT_MS,
    });
    remotePath = listing.stdout.trim();
  } catch (error) {
    return record({ at, remote: null, result: "failed", error: `Serveur injoignable : ${failureMessage(error)}` });
  }
  if (!remotePath) return record({ at, remote: null, result: "failed", error: "Aucun dump sur le serveur" });
  const remote = path.posix.basename(remotePath);
  // Déjà copié et relu : rien jusqu'au prochain dump nocturne.
  const previous = await getSetting("backup.server");
  if (previous?.result === "copied" && previous.remote === remote) return null;

  const target = path.join(/*turbopackIgnore: true*/ dir, serverCopyName(serverDumpDate(remote) ?? new Date(nowMs)));
  // Écrite en .partiel, comme les dumps du lanceur, qui efface les restes au
  // lancement : une copie interrompue ne passe jamais pour une sauvegarde.
  const partial = `${target}.partiel`;
  try {
    await run("scp", ["-q", "-i", key, ...SSH_OPTIONS, `${host}:${remotePath}`, partial], { timeout: COPY_TIMEOUT_MS });
  } catch (error) {
    await rm(partial, { force: true });
    return record({ at, remote, result: "failed", error: `Copie interrompue : ${failureMessage(error)}` });
  }
  const check = await checkDump(partial);
  if (!check.ok) {
    await rm(partial, { force: true });
    return record({ at, remote, result: "unreadable", error: check.error });
  }
  await rename(partial, target);
  // Quota global, toutes catégories : une copie serveur peut chasser une
  // quotidienne plus ancienne qu'elle.
  for (const old of excessBackups(await listBackups())) {
    await rm(path.join(/*turbopackIgnore: true*/ dir, old.name), { force: true });
  }
  return record({ at, remote, result: "copied" });
}
