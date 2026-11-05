import { fail, requirePage } from "@/lib/api";
import { linkedHosts } from "@/lib/pages";

// GET : pages qui montrent la base par une vue liée, nommées dans la
// confirmation de corbeille (étape 16).
export async function GET(_request: Request, ctx: RouteContext<"/api/databases/[id]/hosts">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");
  return Response.json({ hosts: await linkedHosts(id) });
}
