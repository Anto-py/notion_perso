import { fail, readJson, reply, requirePage } from "@/lib/api";
import { updateEntry, type EntryPatch } from "@/lib/databases";

// Au-delà, la requête n'a plus rien d'une base personnelle.
const MAX_ORDER = 10_000;

// PATCH { values?, order? } : valeurs de propriétés (null efface) et/ou ordre
// manuel complet de la base. Titre et corps passent par /api/pages/[id].
export async function PATCH(request: Request, ctx: RouteContext<"/api/entries/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  if (found.page.type !== "entry") return fail(404, "Entrée introuvable");

  const body = await readJson(request);
  if (!body || (!("values" in body) && !("order" in body))) return fail(400, "values ou order attendu");

  const patch: EntryPatch = {};
  if ("values" in body) {
    const values = body.values;
    if (typeof values !== "object" || values === null || Array.isArray(values)) return fail(400, "values invalide");
    patch.values = values as Record<string, unknown>;
  }
  if ("order" in body) {
    const order = body.order;
    if (!Array.isArray(order) || order.length > MAX_ORDER || !order.every((item) => typeof item === "string")) {
      return fail(400, "order invalide");
    }
    patch.order = order as string[];
  }
  return reply(await updateEntry(id, patch));
}
