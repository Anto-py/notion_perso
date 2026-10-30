// Bibliothèque des images d'icône. Passe sous proxy.ts : une icône plafonne à
// 5 Mo, sous la troncature de 10 Mo du proxy.
import { fail, requireUser } from "@/lib/api";
import { addIcon, listIcons } from "@/lib/icon_library";
import { checkIconUpload, cleanIconName, ICON_MAX_BYTES } from "@/lib/icons";

// Marge pour l'enveloppe multipart autour du fichier.
const ENVELOPE_BYTES = 64 * 1024;

// GET → { icons: [{ id, filename, name, uses }] }, retirées exclues.
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json({ icons: await listIcons() });
}

// POST multipart { file, name } → { icon }
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ICON_MAX_BYTES + ENVELOPE_BYTES) return fail(413, "Image trop lourde : la limite d'une icône est de 5 Mo.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Envoi illisible ou interrompu");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Champ file attendu");
  const name = cleanIconName(form.get("name"));
  if (!name) return fail(400, "Donnez un nom à l'image.");

  const check = checkIconUpload(file);
  if (!check.ok) return fail(check.status, check.error);

  return Response.json({ icon: await addIcon(file, check.ext, name) });
}
