import { fail, optionalId, readJson, reply, requirePage } from "@/lib/api";
import { movePageWithWarnings } from "@/lib/page_move_query";

// POST { parentId, before?, confirmed? } : reparente la page ; parentId null la
// remonte à la racine. before (présent) insère la page devant cette sœur, null
// la met en fin de liste ; absent, la page garde sa clé d'ordre. 409 si le
// déplacement créerait une boucle ou si la sœur de référence manque.
// placeBlock: false laisse l'éditeur ouvert poser le bloc de la page là où on
// l'a déposée. Si le déplacement change ce que le public peut lire
// (lib/block_move_share.ts, pageMoveWarnings), 409 { error, warnings } sans
// rien écrire, tant que confirmed n'est pas true.
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
  const outcome = await movePageWithWarnings(id, parentId, found.page.parentId, before, {
    placeBlock: body.placeBlock !== false,
    confirmed: body.confirmed === true,
  });
  if (!outcome.ok && "warnings" in outcome) return Response.json({ error: outcome.error, warnings: outcome.warnings }, { status: 409 });
  return reply(outcome);
}
