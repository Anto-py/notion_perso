// Publier ou dépublier une page, une base ou une entrée. La réponse donne le
// chemin public ; l'adresse complète se compose dans le navigateur.
import { requirePage } from "@/lib/api";
import { publishPage, unpublishPage } from "@/lib/publication_query";

// POST : publie (une page déjà publiée garde son lien) → { publicId }.
export async function POST(_request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  const publicId = await publishPage(found.page);
  return Response.json({ ok: true, publicId });
}

// DELETE : dépublie, le lien cesse aussitôt de répondre.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  await unpublishPage(found.page);
  return Response.json({ ok: true });
}
