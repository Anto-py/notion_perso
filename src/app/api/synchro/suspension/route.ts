// POST { suspend } : Réglages › Synchronisation, « Suspendre » et « Reprendre »
// (BRAINSTORMING §12). Reprendre après une suspension automatique vaut accord
// pour le lot arrêté (sync.waiver), puis lance un cycle sans attendre la
// boucle. 404 sur une instance qui ne se synchronise pas.
import { fail, readJson, requireUser } from "@/lib/api";
import { runCycle } from "@/lib/sync_client";
import { syncConfig } from "@/lib/sync_config";
import { readSuspension, resume, suspendManually } from "@/lib/sync_suspension";

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!syncConfig()) return fail(404, "Cette instance ne se synchronise pas");
  const body = await readJson(request);
  if (typeof body?.suspend !== "boolean") return fail(400, "Champ suspend attendu (true ou false)");
  if (body.suspend) {
    // Une suspension automatique déjà posée garde son motif.
    if (!(await readSuspension())) await suspendManually();
  } else {
    await resume();
    // Le cycle tourne en arrière-plan ; la ligne d'état en suit l'avancement.
    runCycle().catch(() => {});
  }
  return Response.json({ suspended: await readSuspension() });
}
