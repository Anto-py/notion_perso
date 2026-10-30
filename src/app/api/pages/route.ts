import { canAccess } from "@/lib/access";
import { fail, optionalId, readJson, reply, requirePage, requireUser } from "@/lib/api";
import { createPage, listTreeRows } from "@/lib/pages";

// GET : liste plate des pages de la sidebar (l'arbre se construit côté client).
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const rows = await listTreeRows();
  return Response.json({ pages: rows.filter((row) => canAccess(user, row, "read")) });
}

// POST { parentId? } : crée une page vierge, à la racine ou sous parentId.
export async function POST(request: Request) {
  const body = await readJson(request);
  const parentId = optionalId(body?.parentId);
  if (parentId === undefined) return fail(400, "parentId invalide");

  if (parentId) {
    const parent = await requirePage(parentId, "write");
    if (parent instanceof Response) return parent;
  } else {
    const user = await requireUser();
    if (user instanceof Response) return user;
  }

  const outcome = await createPage(parentId);
  return reply(outcome, { id: outcome.id });
}
