import { clientIp } from "@/lib/client_ip";
import { sharedRateLimit, tooManyRequests } from "@/lib/rate_limit";
import { searchVitrine } from "@/lib/vitrine_query";

const limit = sharedRateLimit("veille_recherche", { limit: 120, windowMs: 60_000 });

// Public (proxy.ts ouvre /api/veille/*), sans session : GET ?q=… → résultats
// de la vitrine classés par champ (§2). Le navigateur croise avec ses filtres.
// 120 requêtes par minute et par IP ; 404 sans vitrine active.
export async function GET(request: Request) {
  const taken = limit.take(clientIp(request));
  if (!taken.ok) return tooManyRequests(taken.retryAfter);

  const search = await searchVitrine(new URL(request.url).searchParams.get("q") ?? "");
  if (!search) return Response.json({ error: "Ce contenu n'est plus disponible." }, { status: 404 });
  return Response.json(search, { headers: { "Cache-Control": "no-store" } });
}
