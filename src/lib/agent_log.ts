// Journal des écritures de l'agent (SPECS.md, « Accès agent ») : une ligne
// par geste, les LOG_KEEP dernières gardées. Lu par Réglages › Agent et par
// GET /api/agent/log.
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentLog, agentTokens, pages } from "@/db/schema";
import type { Agent } from "./agent_auth";
import { LOG_KEEP, LOG_SHOWN } from "./agent_rules";
import { newId } from "./ids";

export type LogEntry = {
  id: string;
  at: Date;
  tokenName: string | null;
  model: string | null;
  action: string;
  pageId: string | null;
  pageTitle: string | null;
  detail: Record<string, unknown>;
};

export async function logAgentAction(
  agent: Agent,
  action: string,
  pageId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(agentLog).values({ id: newId("al"), tokenId: agent.tokenId, model: agent.model, action, pageId, detail });
  await db.execute(
    sql`delete from agent_log where id in (select id from agent_log order by at desc, id desc offset ${LOG_KEEP})`,
  );
}

// Le titre vient de la page si elle existe encore, sinon du détail noté au
// moment du geste.
export async function listAgentLog(limit: number = LOG_SHOWN): Promise<LogEntry[]> {
  const rows = await db
    .select({
      id: agentLog.id,
      at: agentLog.at,
      tokenName: agentTokens.name,
      model: agentLog.model,
      action: agentLog.action,
      pageId: agentLog.pageId,
      pageTitle: pages.title,
      detail: agentLog.detail,
    })
    .from(agentLog)
    .leftJoin(agentTokens, eq(agentTokens.id, agentLog.tokenId))
    .leftJoin(pages, eq(pages.id, agentLog.pageId))
    .orderBy(desc(agentLog.at), desc(agentLog.id))
    .limit(Math.max(1, Math.min(limit, LOG_SHOWN)));
  return rows.map((row) => {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const noted = typeof detail.title === "string" ? detail.title : null;
    return { ...row, pageTitle: row.pageTitle ?? noted, detail };
  });
}
