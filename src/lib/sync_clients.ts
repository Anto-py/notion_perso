// Dernier passage connu d'un Mac sur l'app web (« Mac synchronisé à 14:05 »,
// BRAINSTORMING §11). `last_seen_at` est posé par l'authentification de
// chaque appel de synchronisation (lib/sync_server.ts). Vide sur le Mac, dont
// la table sync_clients n'est jamais remplie.
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { syncClients } from "@/db/schema";

export async function lastClientSeen(): Promise<Date | null> {
  const [row] = await db
    .select({ lastSeenAt: syncClients.lastSeenAt })
    .from(syncClients)
    .where(isNotNull(syncClients.lastSeenAt))
    .orderBy(desc(syncClients.lastSeenAt))
    .limit(1);
  return row?.lastSeenAt ?? null;
}
