// Règles pures de l'accès agent (SPECS.md, « Accès agent ») : lecture du
// jeton et du modèle déclaré, nom d'un jeton, datation du dernier usage.
// lib/agent_auth.ts et lib/agent_tokens.ts les appliquent contre la base.

export const MODEL_MAX = 80;
export const TOKEN_NAME_MAX = 60;
export const LOG_KEEP = 1000;
export const LOG_SHOWN = 100;
const TOUCH_EVERY_MS = 60_000;

// Même forme que le jeton de synchronisation (lib/sync_server.ts) : les deux
// sont tirés par newToken, 43 caractères base64url.
export function parseBearer(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header ?? "");
  return match ? match[1] : null;
}

// Nom du modèle annoncé par l'agent (`X-Agent-Model`). Déclaratif : il sert au
// journal, jamais à une décision d'accès.
export function parseModel(header: string | null): string | null {
  const clean = (header ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean === "" ? null : clean.slice(0, MODEL_MAX);
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
