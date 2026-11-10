// POST : dépose une demande de publication (202), exécutée seulement par
// « Valider » dans Réglages › Agent. Refus immédiat pour une page en corbeille,
// déjà publiée ou non publiable (dossier, Vide-cerveau, racine des bases).
// SPECS.md, « Accès agent », palier f.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { requestAgentAction } from "@/lib/agent_requests";
import { publishError } from "@/lib/bases";
import { getPage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/publish">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const page = await getPage(id);
  if (!page || page.trashedAt) return fail(404, "Page introuvable");
  if (page.shareEnabled) return fail(400, "Cette page est déjà publiée.");
  const refused = publishError(page);
  if (refused) return fail(409, refused);
  const demand = await requestAgentAction(agent, "publish", id);
  return Response.json(
    { ok: true, pending: true, request: demand.id, action: "publish", page: { id, title: page.title } },
    { status: 202 },
  );
}
