// Ouvrir (POST) et fermer (DELETE) une sauvegarde de la base locale, sur le
// Mac seulement (palier d de l'étape 12). La session est vérifiée ici comme
// partout : le proxy ne regarde que la présence du cookie.
import { fail, readJson, requireUser } from "@/lib/api";
import { closeBackup, openBackup } from "@/lib/backups";

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name : "";
  try {
    const open = await openBackup(name);
    return Response.json({ ok: true, open });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Ouverture impossible");
  }
}

export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  await closeBackup();
  return Response.json({ ok: true });
}
