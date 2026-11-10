// POST : dépose une demande de suppression définitive (202), exécutée
// seulement par « Valider » dans Réglages › Agent. La page doit d'abord être
// en corbeille, comme dans l'éditeur. SPECS.md, « Accès agent », palier f.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { requestAgentAction } from "@/lib/agent_requests";
import { getPage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/purge">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const page = await getPage(id);
  if (!page) return fail(404, "Page introuvable");
  if (!page.trashedAt) return fail(400, "Mettez la page en corbeille avant de demander sa purge.");
  const demand = await requestAgentAction(agent, "purge", id);
  return Response.json(
    { ok: true, pending: true, request: demand.id, action: "purge", page: { id, title: page.title } },
    { status: 202 },
  );
}
