// Sert un fichier déposé. proxy.ts laisse passer /api/media/* sans cookie :
// la décision est prise ici. En v1, il faut une session ; l'étape 5 ouvrira
// les médias des pages publiées.
import { canAccess } from "@/lib/access";
import { fail, requireUser } from "@/lib/api";
import { getMedia, getPage } from "@/lib/pages";
import { openFile } from "@/lib/storage";
import { isStoredName } from "@/lib/upload_rules";

export async function GET(_request: Request, ctx: RouteContext<"/api/media/[file]">) {
  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(404, "Fichier introuvable");

  const user = await requireUser();
  if (user instanceof Response) return user;

  const row = await getMedia(file);
  if (!row) return fail(404, "Fichier introuvable");
  // Un fichier encore rattaché suit les droits de sa page ; un orphelin
  // (page purgée) reste lisible par l'utilisateur connecté.
  if (row.pageId) {
    const page = await getPage(row.pageId);
    if (page && !canAccess(user, page, "read")) return fail(404, "Fichier introuvable");
  }

  const opened = await openFile(file);
  if (!opened) return fail(404, "Fichier absent du disque");

  // Nom d'origine en RFC 5987 : accents et espaces survivent au téléchargement.
  const name = encodeURIComponent(row.originalName);
  return new Response(opened.stream, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(opened.size),
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      // Le nom est aléatoire et le contenu ne change jamais.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
