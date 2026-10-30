import { fail, readJson, reply, requirePage } from "@/lib/api";
import { trashPage, updatePage, type PagePatch } from "@/lib/pages";

const MAX_TITLE = 500;

export async function GET(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  return Response.json({ page: found.page });
}

// PATCH { title?, icon?, body? } : autosauvegarde de l'éditeur.
export async function PATCH(request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;

  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");

  const patch: PagePatch = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || body.title.length > MAX_TITLE) return fail(400, "Titre invalide");
    patch.title = body.title;
  }
  if ("icon" in body) {
    if (body.icon !== null && (typeof body.icon !== "string" || body.icon.length > 16)) return fail(400, "Icône invalide");
    patch.icon = body.icon;
  }
  if ("body" in body) {
    if (!Array.isArray(body.body)) return fail(400, "Le corps doit être une liste de blocs");
    patch.body = body.body;
  }

  const outcome = await updatePage(id, patch);
  return reply(outcome, { updatedAt: outcome.updatedAt });
}

// DELETE : envoie la page et son sous-arbre en corbeille (jamais de purge ici).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  return reply(await trashPage(id));
}
