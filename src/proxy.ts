// Garde d'auth optimiste : regarde seulement si un cookie de session existe.
// La validité réelle se vérifie dans getCurrentUser(), au plus près des
// données ; chaque route d'API fait son propre contrôle.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session_cookie";

// Chemins ouverts sans session (SPECS.md, « Rôle des fichiers clés »). /share
// et /api/media décident eux-mêmes : refus explicite ou média d'une page publiée.
const PUBLIC_PATHS = [/^\/login$/, /^\/p\//, /^\/api\/auth\//, /^\/share$/, /^\/api\/media\//];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Prolonge la durée de vie du cookie dans le navigateur à chaque visite.
  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

export const config = {
  // Exclut les fichiers statiques et ceux de public/ (manifest, sw.js, icônes).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/).*)"],
};
