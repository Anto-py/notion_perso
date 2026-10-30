// Téléversement de l'image du bandeau d'une page. Sous proxy.ts : une image de
// bandeau plafonne à 5 Mo, sous la troncature de 10 Mo du proxy. Le fichier
// entre dans media avec page_id : il suit donc les droits de sa page (voir
// api/media/[file]) et rien ne l'expose publiquement tant que la page n'est pas
// partagée. L'ancienne image reste sur le disque : rien ne s'efface sans
// l'accord d'Antonin.
import { fail, requirePage } from "@/lib/api";
import { COVER_POSITION_DEFAULT, imageCover } from "@/lib/covers";
import { checkIconUpload, ICON_MAX_BYTES } from "@/lib/icons";
import { newId } from "@/lib/ids";
import { recordMedia, updatePage } from "@/lib/pages";
import { saveFile } from "@/lib/storage";

// Marge pour l'enveloppe multipart autour du fichier.
const ENVELOPE_BYTES = 64 * 1024;

// POST multipart { file } → { cover, position }
export async function POST(request: Request, ctx: RouteContext<"/api/pages/[id]/cover">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ICON_MAX_BYTES + ENVELOPE_BYTES) {
    return fail(413, "Image trop lourde : la limite d'un bandeau est de 5 Mo.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Envoi illisible ou interrompu");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Champ file attendu");

  // Mêmes règles qu'une image d'icône : image seulement, 5 Mo au plus.
  const check = checkIconUpload(file);
  if (!check.ok) return fail(check.status, check.error);

  const mediaId = newId("up");
  const filename = `${mediaId}.${check.ext}`;
  await saveFile(file.stream(), filename);
  await recordMedia({
    id: mediaId,
    filename,
    originalName: file.name.slice(0, 255) || filename,
    mime: file.type,
    size: file.size,
    pageId: id,
  });

  const cover = imageCover(filename);
  const outcome = await updatePage(id, { cover, coverPosition: COVER_POSITION_DEFAULT });
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  return Response.json({ cover, position: COVER_POSITION_DEFAULT });
}
