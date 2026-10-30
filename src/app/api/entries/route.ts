import { fail, readJson, reply, requirePage } from "@/lib/api";
import { createEntry } from "@/lib/databases";

// POST { dbId, values? } : crée une entrée en fin de base, avec d'éventuelles
// valeurs de départ (colonne Kanban d'où l'on part).
export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body?.dbId !== "string") return fail(400, "dbId attendu");
  const values = body.values ?? {};
  if (typeof values !== "object" || values === null || Array.isArray(values)) return fail(400, "values invalide");

  const found = await requirePage(body.dbId, "write");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");

  const outcome = await createEntry(body.dbId, values as Record<string, unknown>);
  return reply(outcome, { id: outcome.id });
}
