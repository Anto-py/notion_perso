// POST { decision: "accepted" | "refused" } : traite une demande de l'agent
// (Réglages › Agent). Sous session, sur l'instance web seulement. « Valider »
// exécute le geste avec les droits d'Antonin ; « Refuser » ferme la demande
// sans rien faire. Si le geste échoue (page disparue, exclusion du partage),
// la demande reste ouverte et l'erreur est rendue telle quelle.
// SPECS.md, « Accès agent », palier f.
import { fail, readJson, requireUser } from "@/lib/api";
import { closeAgentRequest, openAgentRequest } from "@/lib/agent_requests";
import { requestDecision } from "@/lib/agent_rules";
import { purgeWithMedia } from "@/lib/media_cleanup_query";
import { getPage } from "@/lib/pages";
import { publishPage } from "@/lib/publication_query";
import { currentInstance } from "@/lib/settings";

export async function POST(request: Request, ctx: RouteContext<"/api/acces_agent/requests/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (currentInstance() !== "web") return fail(404, "Aucun accès agent sur cette instance");

  const { id } = await ctx.params;
  const body = await readJson(request);
  const decision = requestDecision(body?.decision);
  if (!decision) return fail(400, "Décision attendue : accepted ou refused");

  const demand = await openAgentRequest(id);
  if (!demand) return fail(404, "Demande introuvable ou déjà traitée");

  let publicId: string | undefined;
  if (decision === "accepted") {
    const page = await getPage(demand.pageId);
    // Une purge vise une page en corbeille ; une publication, une page vivante.
    if (!page || (demand.action === "publish" && page.trashedAt)) {
      return fail(409, "Page introuvable : la demande reste ouverte.");
    }
    if (demand.action === "publish") {
      const outcome = await publishPage(page);
      if (!outcome.ok) return fail(outcome.status, outcome.error);
      publicId = outcome.publicId;
    } else {
      const outcome = await purgeWithMedia(demand.pageId);
      if (!outcome.ok) return fail(outcome.status, outcome.error);
    }
  }

  await closeAgentRequest(demand.id, decision);
  return Response.json({
    ok: true,
    action: demand.action,
    decision,
    ...(publicId ? { publicId } : {}),
  });
}
