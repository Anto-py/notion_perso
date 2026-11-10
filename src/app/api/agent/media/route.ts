// POST multipart { file, pageId? } : dépose une image ou un PDF pour l'agent.
// Mêmes règles que api/upload (upload_rules), mais la session est remplacée par
// le jeton d'agent et pageId reste facultatif : `np creer` et `np entree`
// téléversent avant que la page ou l'entrée n'existe, pour que rien ne soit
// écrit si un envoi échoue. Journalisé (téléversement).
// SPECS.md, « Accès agent », palier e.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { logAgentAction } from "@/lib/agent_log";
import { newId } from "@/lib/ids";
import { getPage, recordMedia } from "@/lib/pages";
import { saveFile } from "@/lib/storage";
import { checkUpload, MAX_UPLOAD_BYTES } from "@/lib/upload_rules";

// Marge pour l'enveloppe multipart autour du fichier.
const ENVELOPE_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;

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
  if (!(file instanceof File)) return fail(400, "Champ file attendu");
  const pageId = form.get("pageId");
  if (pageId !== null && typeof pageId !== "string") return fail(400, "pageId invalide");
  if (typeof pageId === "string" && pageId !== "") {
    const page = await getPage(pageId);
    if (!page || page.trashedAt) return fail(404, "Page introuvable");
  }

  const check = checkUpload(file);
  if (!check.ok) return fail(check.status, check.error);

  const id = newId("up");
  const filename = `${id}.${check.ext}`;
  await saveFile(file.stream(), filename);
  await recordMedia({
    id,
    filename,
    originalName: file.name.slice(0, 255),
    mime: file.type,
    size: file.size,
    pageId: typeof pageId === "string" && pageId !== "" ? pageId : null,
  });
  await logAgentAction(agent, "téléversement", typeof pageId === "string" && pageId !== "" ? pageId : null, {
    name: file.name.slice(0, 255),
    filename,
    size: file.size,
  });
  return Response.json({ url: `/api/media/${filename}` }, { status: 201 });
}
