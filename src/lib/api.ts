// Briques communes aux routes d'API : session, accès, réponses d'erreur.
// proxy.ts ne regarde que la présence du cookie ; la session est vérifiée ici.
import { canAccess, type AccessMode } from "./access";
import { getSessionUser, type User } from "./auth";
import { getPage, type Outcome, type Page } from "./pages";

export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export function reply(outcome: Outcome, body: Record<string, unknown> = {}): Response {
  return outcome.ok ? Response.json({ ok: true, ...body }) : fail(outcome.status, outcome.error);
}

export async function requireUser(): Promise<User | Response> {
  const user = await getSessionUser();
  return user ?? fail(401, "Non connecté");
}

// Charge une page hors corbeille et vérifie l'accès. 404 dans les deux cas
// d'échec : ne pas dire qu'une page existe à qui ne peut pas la voir.
export async function requirePage(id: string, mode: AccessMode): Promise<{ user: User; page: Page } | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const page = await getPage(id);
  if (!page || page.trashedAt || !canAccess(user, page, mode)) return fail(404, "Page introuvable");
  return { user, page };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Un id de page facultatif dans un corps JSON : absent ou null → racine.
export function optionalId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
