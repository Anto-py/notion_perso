// Publier, dépublier ou exclure du partage une page, une base ou une entrée.
// La réponse donne le chemin public ; l'adresse complète se compose dans le
// navigateur.
import { fail, readJson, requirePage } from "@/lib/api";
import { publishPage, setShareClosed, shareState, unpublishPage } from "@/lib/publication_query";

// GET : état du panneau → { type, publicId, closed, closedBy, sharedBy,
// privateLinks, openedBases, openedBy }.
export async function GET(_request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  return Response.json({ ok: true, ...(await shareState(found.page)) });
}

// POST : publie (une page déjà publiée garde son lien) → { publicId } ; 409
// pour une page exclue, ou rangée sous une page exclue.
export async function POST(_request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  const outcome = await publishPage(found.page);
  return outcome.ok ? Response.json({ ok: true, publicId: outcome.publicId }) : fail(outcome.status, outcome.error);
}

// PATCH { closed } : pose ou retire l'exclusion du partage des ancêtres ; 409
// pour une page publiée ou qui porte une page publiée dessous.
export async function PATCH(request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  const body = await readJson(request);
  if (!body || typeof body.closed !== "boolean") return fail(400, "Corps { closed } attendu");
  const outcome = await setShareClosed(found.page, body.closed);
  return outcome.ok ? Response.json({ ok: true }) : fail(outcome.status, outcome.error);
}

// DELETE : dépublie, le lien cesse aussitôt de répondre.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  await unpublishPage(found.page);
  return Response.json({ ok: true });
}
