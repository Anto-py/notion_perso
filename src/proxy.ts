// Garde d'auth optimiste : regarde seulement si un cookie de session existe.
// La validité réelle se vérifie dans getCurrentUser(), au plus près des
// données ; chaque route d'API fait son propre contrôle.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session_cookie";
import { loginPath } from "@/lib/share";

// Chemins ouverts sans session (SPECS.md, « Rôle des fichiers clés »).
// /api/media décide lui-même : média d'une page publiée ou refus.
const PUBLIC_PATHS = [/^\/login$/, /^\/p\//, /^\/api\/auth\//, /^\/api\/media\//];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    }
    // L'adresse demandée suit la connexion : un partage reçu du téléphone
    // (/share?url=…) ne se perd pas quand la session a expiré.
    return NextResponse.redirect(new URL(loginPath(pathname + request.nextUrl.search), request.url));
  }

  // Prolonge la durée de vie du cookie dans le navigateur à chaque visite.
  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

export const config = {
  // Exclut les fichiers statiques et ceux de public/ (sw.js, icônes), ainsi
  // que le manifeste, que le navigateur demande sans cookie.
  // Exclut aussi api/upload et api/import : le proxy met tout corps en mémoire
  // et le tronque sans erreur au-delà de 10 Mo (proxyClientMaxBodySize). Ces
  // routes vérifient elles-mêmes la session.
  matcher: ["/((?!_next/static|_next/image|manifest.webmanifest|sw.js|icons/|api/upload|api/import).*)"],
};
