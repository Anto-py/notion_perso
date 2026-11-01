// DELETE : révoque un client de synchronisation (Réglages › Appareils,
// BRAINSTORMING §12). Sous session, hors api/sync/*, que seul le jeton ouvre.
import { fail, requireUser } from "@/lib/api";
import { currentInstance } from "@/lib/settings";
import { revokeClient } from "@/lib/sync_clients";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/appareils/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (currentInstance() !== "web") return fail(404, "Aucun appareil sur cette instance");
  const { id } = await ctx.params;
  const name = await revokeClient(id);
  return name === null ? fail(404, "Appareil introuvable") : Response.json({ ok: true, name });
}
