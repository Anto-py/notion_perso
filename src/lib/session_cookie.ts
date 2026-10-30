// Partagé par proxy.ts et lib/auth.ts, sans dépendance à la base : le proxy
// n'a besoin que du nom et des options du cookie.
export const SESSION_COOKIE = "np_session";

// 90 jours glissants : prolongés à chaque visite.
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}
