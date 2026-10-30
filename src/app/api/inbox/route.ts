import { fail, readJson, requireUser } from "@/lib/api";
import { captureLink, captureNote } from "@/lib/inbox";
import { isFetchableUrl } from "@/lib/unfurl";
import { unfurl } from "@/lib/unfurl_fetch";

const MAX_TEXT = 20_000;

// POST { text } : une note. POST { url, title?, description? } : un lien,
// dont l'aperçu est lu ici si le client ne le fournit pas. Un partage sans
// URL mais avec du texte devient une note (cas limite du BRAINSTORMING).
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = await readJson(request);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";

  if (url) {
    if (url.length > 2048) return fail(400, "Lien trop long");
    if (!isFetchableUrl(url)) return fail(400, "Ce lien ne peut pas être ouvert depuis le serveur");
    const preview =
      typeof body?.title === "string" && body.title.trim()
        ? {
            title: body.title,
            description: typeof body.description === "string" ? body.description : "",
            site: typeof body.source === "string" ? body.source : "",
          }
        : await unfurl(url);
    const captured = await captureLink({ url, title: preview.title, description: preview.description, source: preview.site });
    return Response.json({ ok: true, id: captured.id });
  }

  if (text.length > MAX_TEXT) return fail(400, "Texte trop long");
  const captured = await captureNote(text);
  return Response.json({ ok: true, id: captured.id });
}
