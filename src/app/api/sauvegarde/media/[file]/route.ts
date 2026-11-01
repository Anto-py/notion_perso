// Média cité par la sauvegarde ouverte (palier d) : le dump ne contient pas
// les fichiers, servis depuis uploads/ ou la quarantaine. Session exigée, la
// copie n'étant lisible que dans l'app.
import { fail, requireUser } from "@/lib/api";
import { backupMedia } from "@/lib/backup_read";
import { openFile, openQuarantinedFile } from "@/lib/storage";
import { isStoredName } from "@/lib/upload_rules";

export async function GET(_request: Request, ctx: RouteContext<"/api/sauvegarde/media/[file]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(404, "Fichier introuvable");

  const row = await backupMedia(file);
  if (!row) return fail(404, "Fichier introuvable");

  const opened = (await openFile(file)) ?? (await openQuarantinedFile(file));
  if (!opened) return fail(404, "Fichier absent du disque");

  const name = encodeURIComponent(row.originalName);
  return new Response(opened.stream, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(opened.size),
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
