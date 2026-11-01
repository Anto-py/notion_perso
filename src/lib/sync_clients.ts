// Clients de synchronisation vus de l'app web : dernier passage d'un Mac
// (« Mac synchronisé à 14:05 », BRAINSTORMING §11), liste et révocation
// (Réglages › Appareils, §12). `last_seen_at` est posé par l'authentification de
// chaque appel de synchronisation (lib/sync_server.ts). Vide sur le Mac, dont
// la table sync_clients n'est jamais remplie.
import { asc, desc, eq, isNotNull } from "drizzle-orm";
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

export type ClientRow = { id: string; name: string; lastSeenAt: Date | null; createdAt: Date };

// Réglages › Appareils : jamais l'empreinte du jeton.
export async function listClients(): Promise<ClientRow[]> {
  return db
    .select({ id: syncClients.id, name: syncClients.name, lastSeenAt: syncClients.lastSeenAt, createdAt: syncClients.createdAt })
    .from(syncClients)
    .orderBy(asc(syncClients.createdAt));
}

// Supprimer la ligne révoque le jeton : le prochain appel du client reçoit
// 401. Rend le nom de l'appareil, null s'il n'existait pas.
export async function revokeClient(id: string): Promise<string | null> {
  const [row] = await db.delete(syncClients).where(eq(syncClients.id, id)).returning({ name: syncClients.name });
  return row?.name ?? null;
}
