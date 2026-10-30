import { NextResponse } from "next/server";

// Redirection relative, pour les routes d'API. En production (sortie
// standalone derrière le proxy de Coolify), request.url porte l'adresse
// d'écoute du conteneur, http://0.0.0.0:3000, jamais le domaine public : une
// redirection absolue bâtie dessus enverrait le navigateur nulle part. Un
// Location relatif se résout sur l'adresse que le navigateur a demandée.
// Le proxy de session (proxy.ts) n'en a pas besoin : Next y raccourcit
// lui-même les redirections vers le même hôte. `path` doit être un chemin
// local déjà validé (voir safeReturnPath).
export function redirectTo(path: string, status: 303 | 307 = 303) {
  return new NextResponse(null, { status, headers: { Location: path } });
}
