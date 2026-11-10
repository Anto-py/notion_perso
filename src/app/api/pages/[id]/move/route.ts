import { fail, optionalId, readJson, reply, requirePage } from "@/lib/api";
import { movePage } from "@/lib/pages";

// POST { parentId, before? } : reparente la page ; parentId null la remonte à
// la racine. before (présent) insère la page devant cette sœur, null la met en
// fin de liste ; absent, la page garde sa clé d'ordre. 409 si le déplacement
// créerait une boucle ou si la sœur de référence manque. placeBlock: false
// laisse l'éditeur ouvert poser le bloc de la page là où on l'a déposée.
export async function POST(request: Request, ctx: RouteContext<"/api/pages/[id]/move">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;

  const body = await readJson(request);
  const parentId = optionalId(body?.parentId);
  if (!body || parentId === undefined) return fail(400, "parentId invalide");
  const hasBefore = Object.prototype.hasOwnProperty.call(body, "before");
  const before = hasBefore ? optionalId(body.before) : undefined;
  if (hasBefore && before === undefined) return fail(400, "before invalide");
  if (parentId) {
    const target = await requirePage(parentId, "write");
    if (target instanceof Response) return target;
  }
  return reply(await movePage(id, parentId, before, { placeBlock: body.placeBlock !== false }));
}
