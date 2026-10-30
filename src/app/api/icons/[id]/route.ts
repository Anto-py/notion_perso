import { fail, readJson, reply, requireUser } from "@/lib/api";
import { deleteIcon, updateIcon } from "@/lib/icon_library";
import { cleanIconName } from "@/lib/icons";

// PATCH { name?, hidden? } : renommer, retirer de la bibliothèque (ou y remettre).
export async function PATCH(request: Request, ctx: RouteContext<"/api/icons/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  const patch: { name?: string; hidden?: boolean } = {};
  if ("name" in body) {
    const name = cleanIconName(body.name);
    if (!name) return fail(400, "Donnez un nom à l'image.");
    patch.name = name;
  }
  if ("hidden" in body) {
    if (typeof body.hidden !== "boolean") return fail(400, "hidden doit être un booléen");
    patch.hidden = body.hidden;
  }
  if (!Object.keys(patch).length) return fail(400, "Rien à modifier");
  return reply(await updateIcon(id, patch));
}

// DELETE : supprime l'image et son fichier, 409 si une page l'utilise encore.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/icons/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  return reply(await deleteIcon(id));
}
