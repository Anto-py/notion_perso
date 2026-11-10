// POST { name } : crée un jeton d'agent (Réglages › Agent). Sous session, sur
// l'instance web seulement. Le jeton en clair n'est rendu qu'ici, une fois.
import { checkTokenName } from "@/lib/agent_rules";
import { createAgentToken } from "@/lib/agent_tokens";
import { fail, readJson, requireUser } from "@/lib/api";
import { currentInstance } from "@/lib/settings";

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (currentInstance() !== "web") return fail(404, "Aucun accès agent sur cette instance");
  const body = await readJson(request);
  const name = checkTokenName(body?.name);
  if ("error" in name) return fail(400, name.error);
  const created = await createAgentToken(name.value);
  return Response.json({ ok: true, ...created });
}
