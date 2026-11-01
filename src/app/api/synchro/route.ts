// Synchronisation de l'instance du Mac, vue de son interface (session, et non
// jeton comme api/sync/*, qui sert le serveur). GET : l'état (dernier cycle
// réussi, dernière erreur, lignes en attente, conflits) ; avec ?page=, seule
// cette page attend-elle. POST : lance un cycle (« Synchroniser maintenant »)
// et rend son bilan, 409 si la synchronisation est suspendue. 404 sur une instance qui ne se synchronise pas (VPS,
// développement).
import { fail, requireUser } from "@/lib/api";
import { backupAlert } from "@/lib/backups";
import { countConflicts } from "@/lib/conflicts";
import { readProgress, readReason, runCycle, SyncError } from "@/lib/sync_client";
import { syncConfig } from "@/lib/sync_config";
import { pagePending, readState, scanLocal } from "@/lib/sync_local";
import { readSuspension } from "@/lib/sync_suspension";

export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!syncConfig()) return fail(404, "Cette instance ne se synchronise pas");
  const page = new URL(request.url).searchParams.get("page");
  if (page) return Response.json({ pagePending: await pagePending(page) });
  const [state, scan, conflicts, suspended] = await Promise.all([readState(), scanLocal(), countConflicts(), readSuspension()]);
  return Response.json({
    syncedAt: state?.syncedAt ?? null,
    error: state?.error ?? null,
    // Motif du dernier échec depuis le démarrage (« version » : redémarrer).
    reason: readReason(),
    pending: scan.pending.length,
    conflicts,
    // Avancement du cycle en cours, null au repos.
    progress: readProgress(),
    // Suspension en cours (sync.suspended), null si la synchronisation est active.
    suspended,
    // Sauvegarde ratée au lancement (BACKUP_ALERT du lanceur), null sinon.
    backupAlert: backupAlert(),
  });
}

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!syncConfig()) return fail(404, "Cette instance ne se synchronise pas");
  try {
    const report = await runCycle();
    if (report.skipped) return fail(409, "Synchronisation suspendue : reprendre dans Réglages › Synchronisation");
    return Response.json(report);
  } catch (error) {
    const reason = error instanceof SyncError ? error.reason : "server";
    return Response.json({ error: error instanceof Error ? error.message : String(error), reason }, { status: 502 });
  }
}
