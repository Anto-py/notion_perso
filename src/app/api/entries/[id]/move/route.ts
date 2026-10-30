import { fail, readJson, reply, requirePage } from "@/lib/api";
import { moveEntry } from "@/lib/databases";

// POST { dbId } : déplace une entrée vers une autre base. Les propriétés de
// même nom et même type suivent, les autres valeurs sont laissées.
export async function POST(request: Request, ctx: RouteContext<"/api/entries/[id]/move">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  if (found.page.type !== "entry") return fail(404, "Entrée introuvable");

  const body = await readJson(request);
  if (typeof body?.dbId !== "string" || body.dbId === "") return fail(400, "dbId attendu");

  const target = await requirePage(body.dbId, "write");
  if (target instanceof Response) return target;
  if (target.page.type !== "database") return fail(404, "Base de destination introuvable");

  return reply(await moveEntry(id, body.dbId));
}
