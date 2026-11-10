// Adresse du visiteur, clé des limiteurs (connexion, routes publiques de la
// vitrine). Derrière Coolify, le proxy ajoute l'adresse réelle en fin de
// X-Forwarded-For ; le début de la liste, lui, peut être forgé par le client.
export function clientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || "local";
}
