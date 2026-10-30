import { fail, readJson, reply, requirePage } from "@/lib/api";
import { checkCoverPosition, checkCoverValue } from "@/lib/covers";
import { isLibraryFile } from "@/lib/icon_library";
import { checkIconValue } from "@/lib/icons";
import { getMedia, trashPage, updatePage, type PagePatch } from "@/lib/pages";

const MAX_TITLE = 500;

export async function GET(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  return Response.json({ page: found.page });
}

// PATCH { title?, icon?, cover?, coverPosition?, body? } : autosauvegarde de
// l'éditeur, choix du bandeau et son recadrage.
export async function PATCH(request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;

  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");

  const patch: PagePatch = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || body.title.length > MAX_TITLE) return fail(400, "Titre invalide");
    patch.title = body.title;
  }
  if ("icon" in body) {
    const icon = checkIconValue(body.icon);
    if (!icon.ok) return fail(400, "Icône invalide");
    if (icon.filename && !(await isLibraryFile(icon.filename))) return fail(400, "Image absente de la bibliothèque");
    patch.icon = icon.value;
  }
  if ("cover" in body) {
    const cover = checkCoverValue(body.cover);
    if (!cover.ok) return fail(400, "Bandeau invalide");
    // Une image de bandeau est un média de la page, pas un fichier inventé.
    if (cover.filename && !(await getMedia(cover.filename))) return fail(400, "Image de bandeau introuvable");
    patch.cover = cover.value;
    // Poser un bandeau neuf repart d'un cadrage centré (choix d'Antonin).
    if (cover.value !== null && !("coverPosition" in body)) patch.coverPosition = 50;
  }
  if ("coverPosition" in body) {
    const position = checkCoverPosition(body.coverPosition);
    if (position === null) return fail(400, "Position du bandeau invalide");
    patch.coverPosition = position;
  }
  if ("body" in body) {
    if (!Array.isArray(body.body)) return fail(400, "Le corps doit être une liste de blocs");
    patch.body = body.body;
  }

  const outcome = await updatePage(id, patch);
  return reply(outcome, { updatedAt: outcome.updatedAt });
}

// DELETE : envoie la page et son sous-arbre en corbeille (jamais de purge ici).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  return reply(await trashPage(id));
}
