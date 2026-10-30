import { fail, readJson, reply, requirePage } from "@/lib/api";
import { updateDatabase, type DatabasePatch } from "@/lib/databases";
import { validateProperties } from "@/lib/properties";

// PATCH { properties?, view? } : liste complète des propriétés (le serveur en
// déduit la migration des valeurs) et/ou vue (filtres, tris, Tableau/Kanban).
// Le titre et l'icône passent par /api/pages/[id], comme pour une page.
export async function PATCH(request: Request, ctx: RouteContext<"/api/databases/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");

  const body = await readJson(request);
  if (!body || (!("properties" in body) && !("view" in body))) return fail(400, "properties ou view attendu");

  const patch: DatabasePatch = {};
  if ("properties" in body) {
    const properties = validateProperties(body.properties);
    if (typeof properties === "string") return fail(400, properties);
    patch.properties = properties;
  }
  if ("view" in body) patch.view = body.view;

  const outcome = await updateDatabase(id, patch);
  return reply(outcome, { config: outcome.config });
}
