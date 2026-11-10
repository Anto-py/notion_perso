import { clientIp } from "@/lib/client_ip";
import { sharedRateLimit, tooManyRequests } from "@/lib/rate_limit";
import { logoHost } from "@/lib/vitrine_logo";
import { vitrineLogo } from "@/lib/vitrine_logo_store";
import { vitrineLogoTarget } from "@/lib/vitrine_query";

// 1000 par minute : une classe entière sort souvent par une seule IP, et le
// coût réel (le téléchargement) est déjà borné par le nombre de sites de la
// base, une fois par mois au plus ; un logo en cache se sert en 10 ms.
const limit = sharedRateLimit("veille_logo", { limit: 1000, windowMs: 60_000 });

// Un jour en cache chez le visiteur, logo comme absence : la vitrine en
// demande un par carte.
const CACHE = "public, max-age=86400";

function absent(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": CACHE } });
}

// Public (proxy.ts ouvre /api/veille/*), sans session : logo d'un site de la
// vitrine (§12). 404 sans requête sortante pour un hôte mal formé ou absent
// de la base active ; 404 aussi quand le site n'a pas de logo, la carte
// retombant alors sur l'icône de l'entrée puis l'initiale.
export async function GET(request: Request, { params }: RouteContext<"/api/veille/logo/[host]">) {
  const taken = limit.take(clientIp(request));
  if (!taken.ok) return tooManyRequests(taken.retryAfter);

  const host = logoHost((await params).host);
  const target = host ? await vitrineLogoTarget(host) : null;
  if (!host || !target) return absent();

  let logo;
  try {
    logo = await vitrineLogo(host, target);
  } catch (error) {
    console.error(`Logo de ${host} :`, error);
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!logo) return absent();
  return new Response(logo.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": CACHE,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
