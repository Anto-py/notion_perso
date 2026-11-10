// POST : envoie la page et son sous-arbre en corbeille, comme l'éditeur
// (trashPage) ; jamais de purge, qui attend la validation d'Antonin (palier f).
// Journalisé.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { logAgentAction } from "@/lib/agent_log";
import { getPage, trashPage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/trash">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const page = await getPage(id);
  if (!page || page.trashedAt) return fail(404, "Page introuvable hors corbeille");
  const outcome = await trashPage(id);
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  await logAgentAction(agent, "corbeille", id, { title: page.title });
  return Response.json({ ok: true });
}
