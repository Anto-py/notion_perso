// « Récupérer » depuis l'écran de sauvegarde (palier d) : réécrit la page, ou
// son sous-arbre, comme une modification neuve de la base vive. La transaction
// est dans lib/backup_restore.ts ; ici, la traduction HTTP.
import { fail, readJson, requireUser } from "@/lib/api";
import { recoverFromBackup } from "@/lib/backup_restore";

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await readJson(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return fail(400, "Page non précisée");
  const outcome = await recoverFromBackup(id, body?.subtree === true);
  return outcome.ok ? Response.json({ ok: true, ...outcome.result }) : fail(outcome.status, outcome.error);
}
