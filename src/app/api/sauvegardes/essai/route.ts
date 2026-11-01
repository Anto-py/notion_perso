// Restauration d'essai à la demande (palier e) : le bouton de Réglages ›
// Sauvegardes. La restauration elle-même est dans lib/backup_trial.ts.
import { fail, requireUser } from "@/lib/api";
import { runTrial } from "@/lib/backup_trial";

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    return Response.json({ ok: true, trial: await runTrial() });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Restauration d'essai impossible");
  }
}
