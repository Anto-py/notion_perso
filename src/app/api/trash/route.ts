import { canAccess } from "@/lib/access";
import { fail, readJson, reply, requireUser } from "@/lib/api";
import { getPage, listTrash, purgeExpired, purgePage, restorePage } from "@/lib/pages";

// GET : contenu de la corbeille. Ouvrir la corbeille purge d'abord ce qui y
// dort depuis plus de 30 jours (la purge « à la demande » du plan).
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  await purgeExpired();
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

// DELETE { id } : suppression définitive, sans retour possible.
export async function DELETE(request: Request) {
  const id = await trashedTarget(request);
  if (id instanceof Response) return id;
  return reply(await purgePage(id));
}
