// GET : dernières écritures de l'agent et demandes en attente de validation
// (SPECS.md, « Accès agent »). Ouvert au seul jeton d'agent ; ?limit= borne la
// liste des écritures (LOG_SHOWN au plus).
import { requireAgent } from "@/lib/agent_auth";
import { listAgentLog } from "@/lib/agent_log";
import { listAgentRequests } from "@/lib/agent_requests";

export async function GET(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "");
  const [entries, requests] = await Promise.all([
    listAgentLog(Number.isInteger(limit) && limit > 0 ? limit : undefined),
    listAgentRequests(),
  ]);
  return Response.json({
    entries: entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    requests: requests.map((demand) => ({ ...demand, createdAt: demand.createdAt.toISOString() })),
  });
}
