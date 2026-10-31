// POST { items } → { results } : lignes modifiées sur le Mac, avec leur base
// commune ; le serveur rend l'état de chaque ligne après décision.
import { fail, readJson } from "@/lib/api";
import { parsePush } from "@/lib/sync_protocol";
import { applyPush } from "@/lib/sync_push";
import { requireSyncClient } from "@/lib/sync_server";

export async function POST(request: Request) {
  const client = await requireSyncClient(request);
  if (client instanceof Response) return client;

  const items = parsePush(await readJson(request));
  if (typeof items === "string") return fail(400, items);
  return Response.json({ results: await applyPush(items) });
}
