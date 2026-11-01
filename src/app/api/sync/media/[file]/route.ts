// Fichiers des médias pour l'app Mac : GET les recopie, PUT dépose un fichier
// créé sur le Mac. Un média ne change jamais (nom aléatoire) : un fichier déjà
// présent à la même taille rend le dépôt sans effet. Hors de proxy.ts, comme
// api/upload : le proxy tronquerait un corps de plus de 10 Mo.
import { fail } from "@/lib/api";
import { discardFile, fileSize, openFile, saveFile } from "@/lib/storage";
import { requireSyncClient } from "@/lib/sync_server";
import { MAX_UPLOAD_BYTES, isStoredName } from "@/lib/upload_rules";

export async function GET(request: Request, ctx: RouteContext<"/api/sync/media/[file]">) {
  const client = await requireSyncClient(request);
  if (client instanceof Response) return client;
  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(404, "Fichier introuvable");

  const opened = await openFile(file);
  if (!opened) return fail(404, "Fichier absent du disque");
  return new Response(opened.stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(opened.size),
      "Cache-Control": "no-store",
    },
  });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/sync/media/[file]">) {
  const client = await requireSyncClient(request);
  if (client instanceof Response) return client;
  const { file } = await ctx.params;
  if (!isStoredName(file)) return fail(400, "Nom de fichier refusé");

  const declared = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0) return fail(411, "Content-Length attendu");
  if (declared > MAX_UPLOAD_BYTES) return fail(413, "Fichier trop lourd : la limite est de 100 Mo.");
  if (!request.body) return fail(400, "Corps vide");

  const existing = await fileSize(file);
  if (existing === declared) return Response.json({ ok: true, size: existing });
  if (existing !== null) return fail(409, `Un autre fichier porte ce nom (${existing} octets)`);

  try {
    await saveFile(request.body, file);
  } catch {
    return fail(400, "Envoi interrompu, fichier non gardé");
  }
  const size = await fileSize(file);
  if (size !== declared) {
    await discardFile(file);
    return fail(400, "Envoi incomplet, fichier non gardé");
  }
  return Response.json({ ok: true, size });
}
