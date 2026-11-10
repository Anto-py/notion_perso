// POST : restaure une page de la corbeille et ce qui est parti avec elle
// (restorePage, comme l'écran Corbeille). Journalisé.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { logAgentAction } from "@/lib/agent_log";
import { getPage, restorePage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/restore">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const page = await getPage(id);
  if (!page) return fail(404, "Page introuvable");
  if (!page.trashedAt) return fail(409, "La page n'est pas en corbeille.");
  const outcome = await restorePage(id);
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  await logAgentAction(agent, "restauration", id, { title: page.title });
  return Response.json({ ok: true });
}
