// Dépôt d'une image ou d'un PDF. Cette route est hors du périmètre de
// proxy.ts (voir son matcher) : le proxy met tout corps en mémoire et le
// tronque sans erreur au-delà de 10 Mo. Elle vérifie donc la session seule.
import { fail, requirePage } from "@/lib/api";
import { newId } from "@/lib/ids";
import { recordMedia } from "@/lib/pages";
import { saveFile } from "@/lib/storage";
import { checkUpload, MAX_UPLOAD_BYTES } from "@/lib/upload_rules";

// Marge pour l'enveloppe multipart autour du fichier.
const ENVELOPE_BYTES = 64 * 1024;

// POST multipart { file, pageId } → { url }
export async function POST(request: Request) {
  // Refus avant lecture : un fichier trop lourd n'est même pas reçu.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + ENVELOPE_BYTES) {
    return fail(413, "Fichier trop lourd : la limite est de 100 Mo.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Envoi illisible ou interrompu");
  }
  const file = form.get("file");
  const pageId = form.get("pageId");
  if (!(file instanceof File) || typeof pageId !== "string") return fail(400, "Champs file et pageId attendus");

  const found = await requirePage(pageId, "write");
  if (found instanceof Response) return found;

  const check = checkUpload(file);
  if (!check.ok) return fail(check.status, check.error);

  const id = newId("up");
  const filename = `${id}.${check.ext}`;
  await saveFile(file.stream(), filename);
  await recordMedia({ id, filename, originalName: file.name.slice(0, 255), mime: file.type, size: file.size, pageId });
  return Response.json({ url: `/api/media/${filename}` });
}
