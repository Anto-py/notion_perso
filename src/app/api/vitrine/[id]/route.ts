// Pilotage de la vitrine de veille d'une base (panneau « Partager »), sous
// session : /api/vitrine/* n'est pas dans les chemins publics du proxy.
import { fail, readJson, requirePage } from "@/lib/api";
import { forgetPublicReach } from "@/lib/publication_query";
import { parseVitrinePatch } from "@/lib/vitrine_pilotage";
import { setVitrine, vitrineState } from "@/lib/vitrine_query";

// GET → { enabled, welcomePageId, welcomeTitle, welcomeMissing,
// activeElsewhere, url } ; 404 hors d'une base.
export async function GET(_request: Request, ctx: RouteContext<"/api/vitrine/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "read");
  if (found instanceof Response) return found;
  if (found.page.type !== "database") return fail(404, "Base introuvable");
  return Response.json({ ok: true, ...(await vitrineState(found.page)) });
}

// PUT { enabled?, welcomePageId? } (null retire la page d'accueil) → l'état
// relu ; 409 si une autre base montre déjà la vitrine.
export async function PUT(request: Request, ctx: RouteContext<"/api/vitrine/[id]">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  const patch = parseVitrinePatch(await readJson(request));
  if (!patch) return fail(400, "Corps { enabled?, welcomePageId? } attendu");
  const outcome = await setVitrine(found.page, patch);
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  // Les médias de la vitrine s'ouvrent ou se ferment aussitôt.
  forgetPublicReach();
  const page = await requirePage(id, "read");
  return page instanceof Response ? page : Response.json({ ok: true, ...(await vitrineState(page.page)) });
}
