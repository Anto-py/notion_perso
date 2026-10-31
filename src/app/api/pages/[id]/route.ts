import { fail, readJson, reply, requirePage } from "@/lib/api";
import { checkCoverPosition, checkCoverValue } from "@/lib/covers";
import { isLibraryFile } from "@/lib/icon_library";
import { checkIconValue } from "@/lib/icons";
import { getMedia, trashPage, updatePage, type PagePatch, type SaveCheck } from "@/lib/pages";

const MAX_TITLE = 500;

export async function GET(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  return Response.json({ page: found.page });
}

// PATCH { title?, icon?, cover?, coverPosition?, body?, baseRev?, base? } :
// autosauvegarde de l'éditeur, choix du bandeau et son recadrage. baseRev : la
// révision que l'éditeur a lue ; base { title?, body? } : la dernière version
// que le serveur lui a confirmée, envoyée pour fusionner (lib/web_save.ts).
// Réponse { updatedAt, rev, merged? } ; 409 { rev } si la page a bougé et que
// la base manque.
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

  let check: SaveCheck | undefined;
  if ("baseRev" in body) {
    if (!Number.isSafeInteger(body.baseRev)) return fail(400, "Révision invalide");
    check = { baseRev: body.baseRev as number };
    if ("base" in body) {
      const base = readBase(body.base);
      if (!base) return fail(400, "Base invalide");
      check.base = base;
    }
  }

  const outcome = await updatePage(id, patch, check);
  if (!outcome.ok && outcome.status === 409) return Response.json({ error: outcome.error, rev: outcome.rev }, { status: 409 });
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  return Response.json({ ok: true, updatedAt: outcome.updatedAt, rev: outcome.rev, merged: outcome.merged, conflicts: outcome.conflicts });
}

function readBase(raw: unknown): SaveCheck["base"] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const base = raw as Record<string, unknown>;
  if ("title" in base && (typeof base.title !== "string" || base.title.length > MAX_TITLE)) return null;
  if ("body" in base && !Array.isArray(base.body)) return null;
  return { title: base.title as string | undefined, body: base.body as unknown[] | undefined };
}

// DELETE : envoie la page et son sous-arbre en corbeille (jamais de purge ici).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/pages/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  return reply(await trashPage(id));
}
