// Sert un fichier déposé. proxy.ts laisse passer /api/media/* sans cookie :
// la décision est prise ici. Avec une session, les droits de sa page ; sans
// session, seulement un fichier qui figure dans une page lisible par un lien.
import { canAccess } from "@/lib/access";
import { fail } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { getMedia, getPage } from "@/lib/pages";
import { isMediaPublic } from "@/lib/publication_query";
import { openFile } from "@/lib/storage";
import { isStoredName } from "@/lib/upload_rules";

export async function GET(_request: Request, ctx: RouteContext<"/api/media/[file]">) {
  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(404, "Fichier introuvable");

  const row = await getMedia(file);
  if (!row) return fail(404, "Fichier introuvable");

  const user = await getSessionUser();
  if (user) {
    // Un fichier encore rattaché suit les droits de sa page ; un orphelin
    // (page purgée) reste lisible par l'utilisateur connecté.
    if (row.pageId) {
      const page = await getPage(row.pageId);
      if (page && !canAccess(user, page, "read")) return fail(404, "Fichier introuvable");
    }
  } else if (!(await isMediaPublic(file))) {
    // 404 et non 401 : ne pas dire qu'un fichier existe à qui ne peut le voir.
    return fail(404, "Fichier introuvable");
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
      // Le nom est aléatoire et le contenu ne change jamais. Servi par un lien
      // public, il ne reste en cache qu'une heure : une dépublication doit
      // finir par couper l'accès, y compris chez qui l'a déjà ouvert.
      "Cache-Control": user ? "private, max-age=31536000, immutable" : "private, max-age=3600",
    },
  });
}
