// Jetons d'agent (SPECS.md, « Accès agent ») : création depuis Réglages ›
// Agent, liste et révocation. Le jeton en clair n'existe qu'une fois, dans la
// réponse de création ; la base ne garde que son empreinte.
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens } from "@/db/schema";
import { hashToken, newId, newToken } from "./ids";

export type AgentTokenRow = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

export async function createAgentToken(name: string): Promise<{ id: string; name: string; token: string }> {
  const token = newToken();
  const id = newId("at");
  await db.insert(agentTokens).values({ id, name, tokenHash: hashToken(token) });
  return { id, name, token };
}

// Jamais l'empreinte.
export async function listAgentTokens(): Promise<AgentTokenRow[]> {
  return db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .orderBy(asc(agentTokens.createdAt));
}

// Révoquer date la ligne : le prochain appel reçoit 401, le journal garde le
// nom. Rend le nom, null si le jeton n'existe pas ou l'était déjà.
export async function revokeAgentToken(id: string): Promise<string | null> {
  const [row] = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
    .returning({ name: agentTokens.name });
  return row?.name ?? null;
}
