import { fail, requireUser } from "@/lib/api";
import { isBlockId } from "@/lib/block_link";
import { locateBlock } from "@/lib/block_locate_query";

// GET /api/blocks/<bloc>?not=<page> : la page vivante qui porte ce bloc, hors la
// page `not` où le lien a échoué. Réponse { pageId }, ou 404 si aucune (bloc
// supprimé) : le lien d'un bloc supprimé laisse alors l'ancienne page ouverte.
export async function GET(request: Request, ctx: RouteContext<"/api/blocks/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  if (!isBlockId(id)) return fail(400, "Identifiant de bloc invalide");
  const not = new URL(request.url).searchParams.get("not") ?? "";
  const pageId = await locateBlock(id, not);
  return pageId ? Response.json({ pageId }) : fail(404, "Bloc introuvable");
}
