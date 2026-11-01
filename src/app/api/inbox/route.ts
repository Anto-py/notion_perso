import { fail, readJson, requireUser } from "@/lib/api";
import { captureLink, captureNote } from "@/lib/inbox";
import { isFetchableUrl } from "@/lib/unfurl";
import { unfurl } from "@/lib/unfurl_fetch";

const MAX_TEXT = 20_000;

// POST { text } : une note. POST { url, title?, description?, image? } : un
// lien, dont l'aperçu est lu ici si le client ne le fournit pas. Un partage
// sans URL mais avec du texte devient une note (cas limite du BRAINSTORMING).
// L'image n'est jamais crue sur parole : fetchRemoteImage revérifie son adresse.
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = await readJson(request);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";

  if (url) {
    if (url.length > 2048) return fail(400, "Lien trop long");
    if (!isFetchableUrl(url)) return fail(400, "Ce lien ne peut pas être ouvert depuis le serveur");
    let preview: { title: string; description: string; site: string; image: string | null };
    if (typeof body?.title === "string" && body.title.trim()) {
      preview = {
        title: body.title,
        description: typeof body.description === "string" ? body.description : "",
        site: typeof body.source === "string" ? body.source : "",
        image: typeof body.image === "string" ? body.image : null,
      };
    } else {
      const read = await unfurl(url);
      preview = { title: read.title, description: read.description, site: read.site, image: read.image };
    }
    const captured = await captureLink({
      url,
      title: preview.title,
      description: preview.description,
      source: preview.site,
      image: preview.image,
    });
    return Response.json({ ok: true, id: captured.id });
  }

  if (text.length > MAX_TEXT) return fail(400, "Texte trop long");
  const captured = await captureNote(text);
  return Response.json({ ok: true, id: captured.id });
}
