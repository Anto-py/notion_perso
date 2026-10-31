// Synchronisation côté Mac, le cycle (SPECS.md, « Synchronisation avec l'app
// Mac ») : envoyer ce qui attend, puis lire le flux des changements, puis tout
// écrire en une transaction, puis recopier les fichiers manquants. Envoyer
// d'abord : une base purgée sur le serveur n'efface pas en cascade une entrée
// modifiée ici, le serveur l'ayant reçue et mise en corbeille avant.
// Actif seulement quand SYNC_REMOTE_URL et SYNC_TOKEN sont posés (l'instance
// du Mac) ; le VPS et le serveur de développement n'en font rien.
import { fileSize, openFile, removeFile, saveFile } from "./storage";
import { CONFIRMED_DELETION, latestChanges, planPush, rowKey } from "./sync_client_plan";
import { applyIncoming, listMediaFiles, readState, recordError, scanLocal } from "./sync_local";
import type { Change, PushItem, SyncMedia } from "./sync_protocol";
import type { PushOutcome } from "./sync_push";
import { serverVersion, type ChangesBatch } from "./sync_server";

export type SyncConfig = { remote: string; token: string };

export function syncConfig(): SyncConfig | null {
  const remote = process.env.SYNC_REMOTE_URL;
  const token = process.env.SYNC_TOKEN;
  return remote && token ? { remote, token } : null;
}

// Rythme décidé (choix d'Antonin du 2026-10-31) : au lancement, puis toutes
// les 5 minutes ; le bouton « Synchroniser maintenant » en lance un de plus.
export const SYNC_INTERVAL_MS = 5 * 60_000;
const FILE_CONCURRENCY = 3;

export type CycleReport = {
  pushed: number;
  conflicts: number;
  received: number;
  applied: number;
  kept: number;
  filesUp: number;
  filesDown: number;
  filesRemoved: number;
  filesMissing: number;
  errors: string[];
};

// offline : serveur injoignable. version : schéma ou code différent, l'app
// doit redémarrer pour se mettre à jour. token : jeton refusé.
export class SyncError extends Error {
  constructor(
    readonly reason: "offline" | "version" | "token" | "server",
    message: string,
  ) {
    super(message);
  }
}

async function call(config: SyncConfig, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const version = serverVersion();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  headers.set("X-Sync-Schema", String(version.schema));
  if (version.commit) headers.set("X-Sync-Commit", version.commit);
  let response: Response;
  try {
    response = await fetch(new URL(path, config.remote), { ...init, headers, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
  } catch (error) {
    throw new SyncError("offline", `Serveur injoignable (${error instanceof Error ? error.message : "réseau"}).`);
  }
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  const message = body?.error ?? `Réponse ${response.status} du serveur.`;
  if (response.status === 401) throw new SyncError("token", message);
  // Un 409 sur un fichier dit un nom déjà pris ; ailleurs, une version différente.
  if (response.status === 409 && !path.startsWith("/api/sync/media/")) throw new SyncError("version", message);
  throw new SyncError("server", message);
}

// --- Fichiers ------------------------------------------------------------------

// Fichier d'un média créé sur le Mac, déposé avant sa ligne : le serveur
// refuse une ligne dont le fichier n'est pas arrivé à la bonne taille.
async function upload(config: SyncConfig, row: SyncMedia): Promise<void> {
  const opened = await openFile(row.filename);
  if (!opened) throw new Error("fichier absent du Mac");
  await call(config, `/api/sync/media/${row.filename}`, {
    method: "PUT",
    body: opened.stream,
    headers: { "Content-Length": String(opened.size), "Content-Type": "application/octet-stream" },
    duplex: "half",
    timeoutMs: 10 * 60_000,
  } as RequestInit & { duplex: "half"; timeoutMs: number });
}

async function download(config: SyncConfig, file: { filename: string; size: number }): Promise<void> {
  const response = await call(config, `/api/sync/media/${file.filename}`, { timeoutMs: 10 * 60_000 });
  if (!response.body) throw new Error("réponse vide");
  await saveFile(response.body, file.filename);
  const size = await fileSize(file.filename);
  if (size !== file.size) {
    await removeFile(file.filename);
    throw new Error(`fichier incomplet (${size} octets sur ${file.size})`);
  }
}

async function eachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Tous les fichiers des médias connus, recopiés s'ils manquent : une
// coupure reprend au cycle suivant là où elle s'était arrêtée.
async function fetchMissing(config: SyncConfig, report: CycleReport): Promise<void> {
  const missing: { filename: string; size: number }[] = [];
  for (const file of await listMediaFiles()) if ((await fileSize(file.filename)) === null) missing.push(file);
  await eachLimited(missing, FILE_CONCURRENCY, async (file) => {
    try {
      await download(config, file);
      report.filesDown++;
    } catch (error) {
      if (error instanceof SyncError && error.reason !== "server") throw error;
      report.filesMissing++;
      report.errors.push(`fichier ${file.filename} : ${error instanceof Error ? error.message : error}`);
    }
  });
}

// --- Cycle ------------------------------------------------------------------------

async function cycle(config: SyncConfig): Promise<CycleReport> {
  const report: CycleReport = {
    pushed: 0,
    conflicts: 0,
    received: 0,
    applied: 0,
    kept: 0,
    filesUp: 0,
    filesDown: 0,
    filesRemoved: 0,
    filesMissing: 0,
    errors: [],
  };
  const cursor = (await readState())?.cursor ?? "0";

  // 1. Envoi. Un média dont le fichier n'a pas pu partir reste en attente.
  const scan = await scanLocal();
  const failedUploads = new Set<string>();
  for (const candidate of scan.pending) {
    if (candidate.kind !== "media" || !candidate.row || candidate.base) continue;
    try {
      await upload(config, candidate.row as SyncMedia);
      report.filesUp++;
    } catch (error) {
      if (error instanceof SyncError && error.reason !== "server") throw error;
      failedUploads.add(candidate.id);
      report.errors.push(`média ${candidate.id} : ${error instanceof Error ? error.message : error}`);
    }
  }
  const plan = planPush(scan.pending.filter((c) => !(c.kind === "media" && failedUploads.has(c.id))));
  const received: Change[] = [];
  for (const batch of plan.batches) {
    const response = await call(config, "/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ items: batch satisfies PushItem[] }),
      headers: { "Content-Type": "application/json" },
    });
    const { results } = (await response.json()) as { results: PushOutcome[] };
    for (const outcome of results) {
      const key = rowKey(outcome.kind, outcome.id);
      if ("error" in outcome) {
        plan.sent.delete(key);
        report.errors.push(`${outcome.kind} ${outcome.id} : ${outcome.error}`);
      } else if ("deleted" in outcome) {
        received.push({ kind: outcome.kind, id: outcome.id, rev: CONFIRMED_DELETION, deleted: true });
      } else {
        received.push(outcome as Change);
        if (outcome.kind === "page") report.conflicts += outcome.conflicts;
      }
    }
    report.pushed += batch.length;
  }

  // 2. Lecture du flux, tous les lots, depuis le curseur du cycle précédent.
  // Le xmin du premier lot devient le curseur du suivant (sync_server.ts).
  let nextCursor: string | null = null;
  let after = 0;
  for (;;) {
    const response = await call(config, `/api/sync/changes?cursor=${cursor}&after=${after}`);
    const batch = (await response.json()) as ChangesBatch;
    nextCursor ??= batch.xmin;
    received.push(...batch.changes);
    report.received += batch.changes.length;
    if (!batch.more || !batch.changes.length) break;
    after = batch.changes.at(-1)!.rev;
  }

  // 3. Écriture, en une transaction, curseur compris.
  const outcome = await applyIncoming({ changes: [...latestChanges(received).values()], sent: plan.sent, clean: scan.clean, cursor: nextCursor });
  report.applied = outcome.applied;
  report.kept = outcome.kept;
  report.errors.push(...outcome.skipped);

  // 4. Fichiers : ceux des médias effacés, puis ceux qui manquent.
  for (const filename of outcome.removedFiles) {
    await removeFile(filename);
    report.filesRemoved++;
  }
  await fetchMissing(config, report);
  return report;
}

// Un cycle à la fois : un second appel pendant qu'un cycle tourne reçoit le
// même résultat. Un échec est noté dans sync_state, que lit la ligne d'état.
let running: Promise<CycleReport> | null = null;

export function runCycle(): Promise<CycleReport> {
  const config = syncConfig();
  if (!config) return Promise.reject(new SyncError("server", "Cette instance ne se synchronise pas (SYNC_REMOTE_URL absente)."));
  running ??= cycle(config)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await recordError(message).catch(() => {});
      throw error;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

// Lancé par instrumentation.ts au démarrage de l'instance du Mac.
export function startSyncLoop(): void {
  if (!syncConfig()) return;
  const tick = () => {
    runCycle()
      .then((report) => console.log("Synchronisation :", JSON.stringify(report)))
      .catch((error) => console.error("Synchronisation en échec :", error instanceof Error ? error.message : error));
  };
  setTimeout(tick, 3_000);
  setInterval(tick, SYNC_INTERVAL_MS);
}
