// Effacer une sauvegarde choisie depuis Réglages › Sauvegardes. Le nom est
// vérifié par parseBackupName : les dumps manuels d'avant migration, hors
// liste, ne s'effacent pas par cette route.
import { fail, requireUser } from "@/lib/api";
import { deleteBackup } from "@/lib/backups";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/sauvegardes/[name]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { name } = await ctx.params;
  try {
    await deleteBackup(name);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Effacement impossible");
  }
}
