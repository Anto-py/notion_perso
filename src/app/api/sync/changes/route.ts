// GET ?cursor=X&after=R → { changes, xmin, more } : un lot du flux des
// changements (SPECS.md, « Synchronisation avec l'app Mac », ligne Échange).
import { fail } from "@/lib/api";
import { readAfter, readCursor } from "@/lib/sync_protocol";
import { confirmCursor, readChanges, requireSyncClient } from "@/lib/sync_server";

export async function GET(request: Request) {
  const client = await requireSyncClient(request);
  if (client instanceof Response) return client;

  const params = new URL(request.url).searchParams;
  const cursor = readCursor(params.get("cursor"));
  const after = readAfter(params.get("after"));
  if (cursor === null || after === null) return fail(400, "cursor et after attendus en chiffres");

  // Le premier lot d'un cycle porte le curseur que le client a confirmé.
  if (after === 0) await confirmCursor(client.id, cursor);
  return Response.json(await readChanges(cursor, after));
}
