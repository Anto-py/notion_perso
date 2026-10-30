import { fail, requireUser } from "@/lib/api";
import { isFetchableUrl } from "@/lib/unfurl";
import { unfurl } from "@/lib/unfurl_fetch";

// GET ?url=… : titre, description et image d'une page, lus par le serveur.
// Le repli (domaine seul) est une réponse normale, jamais une erreur : une
// page protégée ne doit pas empêcher la capture.
export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  if (raw.length > 2048) return fail(400, "Lien trop long");
  if (!isFetchableUrl(raw)) return fail(400, "Ce lien ne peut pas être ouvert depuis le serveur");
  return Response.json(await unfurl(raw));
}
