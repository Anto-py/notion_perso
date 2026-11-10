// GET : dernières écritures de l'agent (SPECS.md, « Accès agent »). Ouvert au
// seul jeton d'agent ; ?limit= borne la liste (LOG_SHOWN au plus).
import { requireAgent } from "@/lib/agent_auth";
import { listAgentLog } from "@/lib/agent_log";

export async function GET(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "");
  const entries = await listAgentLog(Number.isInteger(limit) && limit > 0 ? limit : undefined);
  return Response.json({
    entries: entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
  });
}
