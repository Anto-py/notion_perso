import { canAccess } from "@/lib/access";
import { fail, readJson, reply, requirePage } from "@/lib/api";
import { configOf, listEntries, updateDatabase, type DatabasePatch } from "@/lib/databases";
import { validateProperties } from "@/lib/properties";

// GET : la base, sa configuration et ses entrées, pour une vue liée ouverte
// dans une page (le bloc « linked » de l'éditeur). Rien du corps des entrées :
// la vue liée n'affiche que titre, icône, valeurs et image de carte.
export async function GET(_request: Request, ctx: RouteContext<"/api/databases/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");
  const entries = (await listEntries(id)).filter((entry) => canAccess(found.user, entry, "read"));
  return Response.json({
    database: { id: found.page.id, title: found.page.title, icon: found.page.icon },
    config: configOf(found.page),
    entries,
  });
}

// PATCH { properties?, views? } : liste complète des propriétés (le serveur en
// déduit la migration des valeurs) et/ou liste complète des vues (type,
// filtres, tris, colonnes, calculs ; ordre des onglets).
// base { properties?, views? } : les listes d'avant la modification, pour
// fusionner si le serveur a bougé depuis (merged vrai dans la réponse).
// Le titre et l'icône passent par /api/pages/[id], comme pour une page.
export async function PATCH(request: Request, ctx: RouteContext<"/api/databases/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");

  const body = await readJson(request);
  if (!body || (!("properties" in body) && !("views" in body))) return fail(400, "properties ou views attendu");
  if ("views" in body && !Array.isArray(body.views)) return fail(400, "Liste de vues attendue");

  const patch: DatabasePatch = {};
  if ("properties" in body) {
    const properties = validateProperties(body.properties);
    if (typeof properties === "string") return fail(400, properties);
    patch.properties = properties;
  }
  if ("views" in body) patch.views = body.views;
  if ("base" in body) {
    const base = body.base;
    if (typeof base !== "object" || base === null || Array.isArray(base)) return fail(400, "Base invalide");
    const { properties, views } = base as Record<string, unknown>;
    if ((properties !== undefined && !Array.isArray(properties)) || (views !== undefined && !Array.isArray(views))) return fail(400, "Base invalide");
    patch.base = { properties, views };
  }

  const outcome = await updateDatabase(id, patch);
  return reply(outcome, { config: outcome.config, merged: outcome.merged });
}
