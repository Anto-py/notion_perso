// Import d'un export Notion (zip Markdown & CSV). Cette route est hors du
// périmètre de proxy.ts (voir son matcher) : le proxy tronque sans erreur tout
// corps au-delà de 10 Mo. Elle vérifie donc la session elle-même.
import { fail, requireUser } from "@/lib/api";
import { applyImportPlan } from "@/lib/import_write";
import { buildImportPlan, MAX_IMPORT_BYTES, NotionImportError } from "@/lib/notion-import";

// Marge pour l'enveloppe multipart autour du fichier.
const ENVELOPE_BYTES = 64 * 1024;

// POST multipart { file } → rapport d'import
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES + ENVELOPE_BYTES) {
    return fail(413, "Archive trop lourde : la limite est de 500 Mo.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Envoi illisible ou interrompu");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Archive zip attendue");
  if (file.size > MAX_IMPORT_BYTES) return fail(413, "Archive trop lourde : la limite est de 500 Mo.");

  let plan;
  try {
    plan = buildImportPlan(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // Une archive illisible ou un export HTML sont des refus explicables, pas
    // des pannes : 422 et le message du parseur.
    if (error instanceof NotionImportError) return fail(422, error.message);
    throw error;
  }

  try {
    await applyImportPlan(plan);
  } catch (error) {
    console.error("Import Notion interrompu", error instanceof Error ? error.message : error);
    return fail(500, "L'import a échoué avant la fin : rien n'a été conservé.");
  }

  return Response.json(plan.report);
}
