// Garde des routes /api/agent/* (SPECS.md, « Accès agent »). proxy.ts les
// laisse passer sans cookie : chaque route appelle requireAgent. Seule la
// table agent_tokens est lue, si bien que le jeton du Mac (sync_clients) n'ouvre
// rien ici, et qu'un jeton d'agent n'ouvre pas api/sync/*.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens } from "@/db/schema";
import { fail } from "./api";
import { parseBearer, parseModel, touchDue } from "./agent_rules";
import { hashToken } from "./ids";

export type Agent = { tokenId: string; tokenName: string; model: string | null };

export async function requireAgent(request: Request): Promise<Agent | Response> {
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) return fail(401, "Jeton refusé");
  const [row] = await db
    .select({ id: agentTokens.id, name: agentTokens.name, lastUsedAt: agentTokens.lastUsedAt })
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, hashToken(token)), isNull(agentTokens.revokedAt)))
    .limit(1);
  if (!row) return fail(401, "Jeton refusé");
  const now = new Date();
  if (touchDue(row.lastUsedAt, now)) {
    await db.update(agentTokens).set({ lastUsedAt: now }).where(eq(agentTokens.id, row.id));
  }
  return { tokenId: row.id, tokenName: row.name, model: parseModel(request.headers.get("x-agent-model")) };
}
