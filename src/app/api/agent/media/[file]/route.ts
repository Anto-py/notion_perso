// GET : un média déposé, pour `np lire --medias`. La route publique
// /api/media/[file] décide par session ou par publication ; ici le jeton
// d'agent suffit, comme pour le reste de l'API agent. Aucune journalisation :
// une lecture n'est pas une écriture. Cache no-store : np veut les octets du
// moment, pas une copie d'hier.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { getMedia } from "@/lib/pages";
import { openFile } from "@/lib/storage";
import { isStoredName } from "@/lib/upload_rules";

export async function GET(request: Request, ctx: RouteContext<"/api/agent/media/[file]">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(404, "Fichier introuvable");
  const row = await getMedia(file);
  if (!row) return fail(404, "Fichier introuvable");
  const opened = await openFile(file);
  if (!opened) return fail(404, "Fichier absent du disque");
  return new Response(opened.stream, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(opened.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
