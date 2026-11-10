// GET : le Vide-cerveau en Markdown, lu sans rien y toucher (SPECS.md,
// « Accès agent »). `np vide-cerveau` l'écrit dans un fichier daté.
import { requireAgent } from "@/lib/agent_auth";
import { readInbox } from "@/lib/agent_read";
import { requestOrigin } from "@/lib/agent_rules";

export async function GET(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const origin = requestOrigin(request);
  return Response.json(await readInbox(origin));
}
