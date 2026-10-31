// Synchronisation de l'instance du Mac, vue de son interface (session, et non
// jeton comme api/sync/*, qui sert le serveur). GET : l'état (dernier cycle
// réussi, dernière erreur, lignes en attente). POST : lance un cycle
// (« Synchroniser maintenant ») et rend son bilan. 404 sur une instance qui ne
// se synchronise pas (VPS, développement).
import { fail, requireUser } from "@/lib/api";
import { runCycle, SyncError, syncConfig } from "@/lib/sync_client";
import { readState, scanLocal } from "@/lib/sync_local";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!syncConfig()) return fail(404, "Cette instance ne se synchronise pas");
  const [state, scan] = await Promise.all([readState(), scanLocal()]);
  return Response.json({ syncedAt: state?.syncedAt ?? null, error: state?.error ?? null, pending: scan.pending.length });
}

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!syncConfig()) return fail(404, "Cette instance ne se synchronise pas");
  try {
    return Response.json(await runCycle());
  } catch (error) {
    const reason = error instanceof SyncError ? error.reason : "server";
    return Response.json({ error: error instanceof Error ? error.message : String(error), reason }, { status: 502 });
  }
}
