import { fail, readJson, requireUser } from "@/lib/api";
import { parseCapture } from "@/lib/capture";
import { captureLink, captureNote } from "@/lib/inbox";
import { captureIntoDatabase } from "@/lib/share_capture";
import { isFetchableUrl } from "@/lib/unfurl";
import { unfurl } from "@/lib/unfurl_fetch";

const MAX_TEXT = 20_000;

// POST { text } : capture rapide dans la page Vide-cerveau, une adresse seule
// devenant une mention. POST { url, title?, …, destination? } : écran de
// partage ; sans destination, la mention va au Vide-cerveau, sinon l'entrée
// est créée directement dans la base choisie. Une adresse non joignable n'est
// pas refusée : la capture se fait avec le domaine pour titre.
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = await readJson(request);
  const sharedUrl = typeof body?.url === "string" ? body.url.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";
  const destination = typeof body?.destination === "string" ? body.destination.trim() : "";

  if (sharedUrl.length > 2048) return fail(400, "Lien trop long");
  if (text.length > MAX_TEXT) return fail(400, "Texte trop long");

  if (destination) {
    const saved = await captureIntoDatabase(destination, {
      url: sharedUrl || undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      description: typeof body?.description === "string" ? body.description : undefined,
      source: typeof body?.source === "string" ? body.source : undefined,
      image: typeof body?.image === "string" ? body.image : null,
      text: text || undefined,
    });
    return saved.ok ? Response.json({ ok: true, id: saved.id }) : fail(saved.status, saved.error);
  }

  if (sharedUrl) {
    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : await readTitle(sharedUrl);
    const captured = await captureLink({ url: sharedUrl, title });
    return Response.json({ ok: true, id: captured.id });
  }

  const capture = parseCapture(text);
  if (!capture) return fail(400, "Rien à capturer");
  if (capture.kind === "link") {
    if (capture.url.length > 2048) return fail(400, "Lien trop long");
    const captured = await captureLink({ url: capture.url, title: await readTitle(capture.url) });
    return Response.json({ ok: true, id: captured.id });
  }
  const captured = await captureNote(capture.text);
  return Response.json({ ok: true, id: captured.id });
}

async function readTitle(url: string): Promise<string | undefined> {
  if (!isFetchableUrl(url)) return undefined;
  try {
    return (await unfurl(url)).title;
  } catch {
    return undefined;
  }
}
