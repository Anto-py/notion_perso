// GET ?q= : recherche de l'éditeur pour l'agent (SPECS.md, « Accès agent »),
// chemin de titres et extrait compris.
import { fail } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { searchForAgent } from "@/lib/agent_read";
import { SEARCH_MIN_LENGTH } from "@/lib/search";

export async function GET(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < SEARCH_MIN_LENGTH) return fail(400, `Recherche trop courte (${SEARCH_MIN_LENGTH} caractères au moins)`);
  return Response.json({ results: await searchForAgent(query) });
}
