// POST : dépublie, le lien public cesse aussitôt de répondre. Publier attend
// la validation d'Antonin (palier f) ; dépublier ne demande rien, le geste ne
// fait que refermer. Une page déjà privée répond { changed: false }, sans
// entrée au journal.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { getPage } from "@/lib/pages";
import { unpublishPage } from "@/lib/publication_query";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/unpublish">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const page = await getPage(id);
  if (!page) return fail(404, "Page introuvable");
  if (!page.shareEnabled) return Response.json({ ok: true, changed: false });
  await unpublishPage(page);
  return Response.json({ ok: true, changed: true });
}
