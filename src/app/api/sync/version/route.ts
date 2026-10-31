// Version du serveur (dernière migration, commit), lue par l'app Mac au
// lancement pour se mettre à jour avant d'échanger. Sans contrôle de version,
// par construction.
import { requireSyncClient, serverVersion } from "@/lib/sync_server";

export async function GET(request: Request) {
  const client = await requireSyncClient(request, false);
  if (client instanceof Response) return client;
  return Response.json(serverVersion());
}
