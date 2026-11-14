import { getSessionUser } from "@/lib/auth";
import { clientIp } from "@/lib/client_ip";
import { publicMentionHosts } from "@/lib/publication_query";
import { sharedRateLimit, tooManyRequests } from "@/lib/rate_limit";
import { siteHost } from "@/lib/site_host";
import { vitrineLogo } from "@/lib/vitrine_logo_store";

// Icône d'un site cité par une mention (étape 22), servie par l'instance :
// le navigateur du lecteur, visiteur public compris, ne demande jamais le
// favicon au site. Même magasin que les logos de la vitrine, un
// téléchargement par site pour les deux usages.
const limit = sharedRateLimit("favicon", { limit: 1000, windowMs: 60_000 });

// Un jour en cache chez le lecteur, icône comme absence.
const CACHE = "public, max-age=86400";

function absent(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": CACHE } });
}

export async function GET(request: Request, { params }: RouteContext<"/api/favicon/[host]">) {
  const taken = limit.take(clientIp(request));
  if (!taken.ok) return tooManyRequests(taken.retryAfter);

  const host = siteHost((await params).host);
  if (!host) return absent();

  // Sans session, seul un hôte cité par une mention d'une page de la portée
  // publique : le serveur ne visite jamais un site choisi par un visiteur.
  if (!(await getSessionUser()) && !(await publicMentionHosts()).has(host)) return absent();

  let logo;
  try {
    logo = await vitrineLogo(host, `https://${host}/`);
  } catch (error) {
    console.error(`Favicon de ${host} :`, error);
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
