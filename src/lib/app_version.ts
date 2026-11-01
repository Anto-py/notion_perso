// Changer de version sur le Mac, côté serveur (SPECS.md, « Changer de version
// (Mac) ») : le lanceur construit et bascule (scripts/notion_lancer.sh), le
// serveur l'appelle, lit l'état dans versions/ et demande la bascule par le
// code de sortie 75. Hors du lanceur (VPS, développement), rien de tout cela.
import { execFile, spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  formatDemand,
  isCommit,
  parsePreparation,
  preparationState,
  type Fallback,
  type PreparationState,
  type VersionDemand,
} from "./version_rules";

const run = promisify(execFile);

type Launcher = { script: string; versions: string };

// Posés par le lanceur : le chemin du script et son dossier versions/.
function launcher(): Launcher | null {
  const script = process.env.NOTION_APP_LANCEUR;
  const versions = process.env.APP_VERSIONS_DIR;
  if (!script || !versions) return null;
  return { script: path.resolve(/*turbopackIgnore: true*/ script), versions: path.resolve(/*turbopackIgnore: true*/ versions) };
}

export function canSwitchVersion(): boolean {
  return launcher() !== null;
}

function inVersions(l: Launcher, name: string): string {
  return path.join(/*turbopackIgnore: true*/ l.versions, name);
}

// Le lanceur ne reçoit que l'essentiel : hérité du serveur, NODE_ENV=production
// ferait sauter les dépendances de développement à npm ci, donc le build, et
// le jeton de synchronisation n'a rien à y faire.
function launcherEnv(): NodeJS.ProcessEnv {
  const keep = ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "NOTION_APP_DOSSIER"];
  // Sans NODE_ENV, voulu : le type de Next l'exige, d'où la conversion.
  return Object.fromEntries(keep.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))) as NodeJS.ProcessEnv;
}

// Le commit du dernier déploiement Coolify, que le lanceur lit avec le jeton
// du trousseau (jamais vu du serveur). null : Coolify injoignable.
export async function latestCommit(): Promise<string | null> {
  const l = launcher();
  if (!l) return null;
  try {
    const { stdout } = await run("bash", [l.script, "--verifier"], { env: launcherEnv(), timeout: 20_000 });
    const commit = stdout.trim();
    return isCommit(commit) ? commit : null;
  } catch {
    return null;
  }
}

export function fallbackVersion(): Fallback | null {
  const commit = process.env.APP_FALLBACK_COMMIT?.trim();
  const schema = Number(process.env.APP_FALLBACK_SCHEMA);
  return isCommit(commit) && Number.isFinite(schema) ? { commit, schema } : null;
}

async function readText(file: string): Promise<string | null> {
  return readFile(file, "utf8").catch(() => null);
}

// versions/.epingle : la version de secours choisie, que le lanceur garde aux
// lancements suivants au lieu de mettre à jour.
export async function pinnedCommit(): Promise<string | null> {
  const l = launcher();
  if (!l) return null;
  const commit = (await readText(inVersions(l, ".epingle")))?.trim();
  return isCommit(commit) ? commit : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function preparation(commit: string): Promise<PreparationState> {
  const l = launcher();
  if (!l) return "a_preparer";
  const built = await access(path.join(/*turbopackIgnore: true*/ l.versions, commit, "server.js")).then(
    () => true,
    () => false,
  );
  const marker = parsePreparation(await readText(inVersions(l, ".preparation")));
  return preparationState({ commit, built, marker, alive: marker !== null && "pid" in marker && alive(marker.pid) });
}

// Construction détachée : elle survit à la réponse et tourne pendant qu'on
// travaille. Le marqueur est écrit tout de suite, pour qu'un relevé immédiat
// la voie déjà en cours ; le lanceur le réécrit avec le même pid.
export async function startPreparation(commit: string): Promise<void> {
  const l = launcher();
  if (!l) throw new Error("Instance hors du lanceur");
  const child = spawn("bash", [l.script, "--preparer", commit], { detached: true, stdio: "ignore", env: launcherEnv() });
  child.unref();
  if (child.pid) await writeFile(inVersions(l, ".preparation"), `${commit} ${child.pid}\n`);
}

// Lue par le lanceur quand le serveur sort en RESTART_EXIT_CODE.
export async function requestSwitch(demand: VersionDemand): Promise<void> {
  const l = launcher();
  if (!l) throw new Error("Instance hors du lanceur");
  await writeFile(inVersions(l, ".demande"), formatDemand(demand));
}
