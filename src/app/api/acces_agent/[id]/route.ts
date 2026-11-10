// DELETE : révoque un jeton d'agent (Réglages › Agent). Sous session, sur
// l'instance web seulement ; la ligne reste, datée, pour le journal.
import { revokeAgentToken } from "@/lib/agent_tokens";
import { fail, requireUser } from "@/lib/api";
import { currentInstance } from "@/lib/settings";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/acces_agent/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (currentInstance() !== "web") return fail(404, "Aucun accès agent sur cette instance");
  const { id } = await ctx.params;
  const name = await revokeAgentToken(id);
  return name === null ? fail(404, "Jeton introuvable ou déjà révoqué") : Response.json({ ok: true, name });
}
