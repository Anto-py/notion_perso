import { canAccess } from "@/lib/access";
import { fail, readJson, reply, requireUser } from "@/lib/api";
import { emptyTrash, purgeWithMedia, tryCleanMedia } from "@/lib/media_cleanup_query";
import { getPage, listTrash, purgeExpired, restorePage } from "@/lib/pages";

// GET : contenu de la corbeille. Ouvrir la corbeille purge d'abord ce qui y
// dort depuis plus de 30 jours (la purge « à la demande » du plan), puis
// balaie les médias inutilisés.
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  await purgeExpired();
  await tryCleanMedia();
  const items = await listTrash();
  return Response.json({ items: items.filter((item) => canAccess(user, item, "read")) });
}

// Un élément de la corbeille, accessible en écriture.
async function trashedTarget(request: Request): Promise<string | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await readJson(request);
  if (typeof body?.id !== "string") return fail(400, "id attendu");
  const page = await getPage(body.id);
  if (!page || !page.trashedAt || !canAccess(user, page, "write")) return fail(404, "Élément introuvable dans la corbeille");
  return page.id;
}

// POST { id } : restaure l'élément et ce qui est parti avec lui.
export async function POST(request: Request) {
  const id = await trashedTarget(request);
  if (id instanceof Response) return id;
  return reply(await restorePage(id));
}

// DELETE { id } : suppression définitive, sans retour possible, médias
// compris. DELETE ?tout=1 : vide toute la corbeille (paramètre plutôt que
// corps, trashedTarget lisant déjà le corps de la purge à l'unité).
export async function DELETE(request: Request) {
  if (new URL(request.url).searchParams.get("tout") === "1") {
    const user = await requireUser();
    if (user instanceof Response) return user;
    const purged = await emptyTrash((item) => canAccess(user, item, "write"));
    return Response.json({ ok: true, purged });
  }
  const id = await trashedTarget(request);
  if (id instanceof Response) return id;
  return reply(await purgeWithMedia(id));
}
