import { clientIp } from "@/lib/client_ip";
import { sharedRateLimit, tooManyRequests } from "@/lib/rate_limit";
import { vitrineSheet } from "@/lib/vitrine_query";

const limit = sharedRateLimit("veille_fiche", { limit: 120, windowMs: 60_000 });

// Public (proxy.ts ouvre /api/veille/*), sans session : notes d'une fiche de
// la vitrine (§6), `{ slug, html }`. 120 requêtes par minute et par IP ; 404
// sans vitrine active ou pour une entrée inconnue.
export async function GET(request: Request, { params }: RouteContext<"/api/veille/fiche/[slug]">) {
  const taken = limit.take(clientIp(request));
  if (!taken.ok) return tooManyRequests(taken.retryAfter);

  const sheet = await vitrineSheet((await params).slug);
  if (!sheet) return Response.json({ error: "Cette ressource n'est plus dans la veille." }, { status: 404 });
  return Response.json(sheet, { headers: { "Cache-Control": "no-store" } });
}
