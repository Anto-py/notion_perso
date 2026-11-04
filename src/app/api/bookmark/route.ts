// Aperçu d'un signet : le serveur lit le titre, la description, l'image et le
// favicon du site, rapatrie les deux images en médias de la page, et rend
// leurs adresses. Une adresse illisible ou privée rend un signet réduit à
// l'adresse, sans erreur : c'est le comportement du BRAINSTORMING §2.
import { Readable } from "node:stream";
import { fail, readJson, requirePage, requireUser } from "@/lib/api";
import { newId } from "@/lib/ids";
import { recordMedia } from "@/lib/pages";
import { saveFile } from "@/lib/storage";
import { isFetchableUrl } from "@/lib/unfurl";
import { fetchRemoteImage, unfurl, type RemoteImage } from "@/lib/unfurl_fetch";

type Body = { url?: unknown; pageId?: unknown };

function filenameOf(url: string): string {
  const path = url.split("?")[0].split("#")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name).slice(0, 255) || "image";
  } catch {
    return name.slice(0, 255) || "image";
  }
}

// Enregistre une image distante comme média de la page (ou de la bibliothèque
// si pageId est vide). Rend son URL servie par /api/media.
async function storeImage(image: RemoteImage | null, url: string, pageId: string | null): Promise<string> {
  if (!image) return "";
  const id = newId("up");
  const filename = `${id}.${image.ext}`;
  await saveFile(Readable.toWeb(Readable.from([image.bytes])) as ReadableStream<Uint8Array>, filename);
  await recordMedia({
    id,
    filename,
    originalName: filenameOf(url),
    mime: image.mime,
    size: image.bytes.length,
    pageId,
  });
  return `/api/media/${filename}`;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await readJson(request)) as Body | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return fail(400, "Adresse attendue");
  if (!isFetchableUrl(url)) {
    // Adresse privée, locale ou invalide : le bloc garde l'adresse, sans aperçu.
    return Response.json({ ok: true, title: url, description: "", favicon: "", image: "" });
  }

  let pageId: string | null = null;
  if (typeof body?.pageId === "string" && body.pageId) {
    const found = await requirePage(body.pageId, "write");
    if (found instanceof Response) return found;
    pageId = body.pageId;
  }

  const preview = await unfurl(url);
  const [image, favicon] = await Promise.all([
    preview.image ? fetchRemoteImage(preview.image) : Promise.resolve(null),
    preview.icon ? fetchRemoteImage(preview.icon) : Promise.resolve(null),
  ]);
  const [imageUrl, faviconUrl] = await Promise.all([
    storeImage(image, preview.image ?? "", pageId),
    storeImage(favicon, preview.icon ?? "", pageId),
  ]);

  return Response.json({
    ok: true,
    title: preview.title,
    description: preview.description,
    favicon: faviconUrl,
    image: imageUrl,
  });
}
