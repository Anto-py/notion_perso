import { fail, optionalId, readJson, reply, requirePage } from "@/lib/api";
import { movePage } from "@/lib/pages";

// POST { parentId } : reparente la page ; parentId null la remonte à la racine.
// 409 si le déplacement créerait une boucle.
export async function POST(request: Request, ctx: RouteContext<"/api/pages/[id]/move">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;

  const body = await readJson(request);
  const parentId = optionalId(body?.parentId);
  if (!body || parentId === undefined) return fail(400, "parentId invalide");
  if (parentId) {
    const target = await requirePage(parentId, "write");
    if (target instanceof Response) return target;
  }
  return reply(await movePage(id, parentId));
}
