// Règles pures de l'accès agent (SPECS.md, « Accès agent ») : lecture du
// jeton et du modèle déclaré, nom d'un jeton, datation du dernier usage.
// lib/agent_auth.ts et lib/agent_tokens.ts les appliquent contre la base.

export const MODEL_MAX = 80;
export const TOKEN_NAME_MAX = 60;
const TOUCH_EVERY_MS = 60_000;

// Même forme que le jeton de synchronisation (lib/sync_server.ts) : les deux
// sont tirés par newToken, 43 caractères base64url.
export function parseBearer(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header ?? "");
  return match ? match[1] : null;
}

// Nom du modèle annoncé par l'agent (`X-Agent-Model`). Déclaratif : il n'entre
// dans aucune décision d'accès.
export function parseModel(header: string | null): string | null {
  const clean = (header ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean === "" ? null : clean.slice(0, MODEL_MAX);
}

// Gestes qui passent par une validation humaine (palier f) : publication,
// suppression définitive, et depuis le 2026-11-13 le déplacement qui change ce
// que le public lit (lib/block_move_share.ts, pageMoveWarnings ; un déplacement
// sans effet public reste immédiat). Dépublier, corbeille et restauration
// restent immédiats.
export const REQUEST_ACTIONS = ["publish", "purge", "move"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];
export const REQUEST_DECISIONS = ["accepted", "refused"] as const;
export type RequestDecision = (typeof REQUEST_DECISIONS)[number];

export function isRequestAction(raw: unknown): raw is RequestAction {
  return typeof raw === "string" && (REQUEST_ACTIONS as readonly string[]).includes(raw);
}

export function requestDecision(raw: unknown): RequestDecision | null {
  return raw === "accepted" || raw === "refused" ? raw : null;
}

// Verbe de la demande, tel que le lit Antonin dans Réglages.
export function requestActionLabel(action: RequestAction): string {
  return action === "publish" ? "Publier" : action === "purge" ? "Purger" : "Déplacer";
}

export function checkTokenName(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Nom du jeton attendu" };
  const name = raw.trim();
  if (name === "") return { error: "Nom du jeton vide" };
  if (name.length > TOKEN_NAME_MAX) return { error: `Nom du jeton trop long (${TOKEN_NAME_MAX} caractères au plus)` };
  return { value: name };
}

// Le dernier usage se date au plus une fois par minute : un agent qui
// enchaîne cinquante lectures n'écrit pas cinquante fois la ligne du jeton.
export function touchDue(lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt === null || now.getTime() - lastUsedAt.getTime() >= TOUCH_EVERY_MS;
}

// Origine publique d'une requête, pour les liens absolus du Markdown exporté.
// En production, request.url porte l'adresse d'écoute du conteneur
// (lib/redirect.ts) ; l'en-tête Host, transmis tel quel par le proxy de
// Coolify, porte le domaine. Un hôte malformé ne donne aucune origine : les
// liens restent alors relatifs.
export function publicOrigin(host: string | null, forwardedProto: string | null): string | null {
  const name = (host ?? "").trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(name)) return null;
  const proto = (forwardedProto ?? "").split(",")[0].trim().toLowerCase();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(name);
  const scheme = proto === "http" || proto === "https" ? proto : local ? "http" : "https";
  return `${scheme}://${name}`;
}

export function requestOrigin(request: Request): string | null {
  return publicOrigin(request.headers.get("host"), request.headers.get("x-forwarded-proto"));
}
