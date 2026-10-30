// Partage natif (share_target de la PWA) et retour après connexion. Module
// pur, sans base ni réseau.

export type SharedInput = { title?: unknown; text?: unknown; url?: unknown };

export type SharedPayload =
  | { kind: "link"; url: string; title: string }
  | { kind: "note"; text: string }
  | { kind: "empty" };

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
const SHARE_FIELD_MAX = 20_000;

function field(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, SHARE_FIELD_MAX) : "";
}

function isHttp(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Une adresse prise dans une phrase emporte souvent la ponctuation qui la
// suit. La parenthèse fermante ne part que si l'adresse n'en ouvre aucune
// (les pages Wikipédia en portent).
function trimTrailing(url: string): string {
  let out = url.replace(/[.,;:!?'»]+$/, "");
  if (out.endsWith(")") && !out.includes("(")) out = out.slice(0, -1);
  return out;
}

// Ce que le téléphone envoie varie : iOS remplit url, Android range souvent
// l'adresse dans text (« Titre de l'article https://… ») et laisse url vide.
// Une adresse trouvée fait un lien, sinon le texte fait une note.
export function sharedPayload(input: SharedInput): SharedPayload {
  const title = field(input.title);
  const text = field(input.text);
  const url = field(input.url);

  const fromText = text.match(URL_IN_TEXT)?.[0];
  const found = url && isHttp(url) ? url : fromText ? trimTrailing(fromText) : "";
  if (found && isHttp(found)) {
    const rest = (fromText ? text.replace(fromText, "") : text).trim();
    return { kind: "link", url: found, title: title || rest.split(/\r?\n/)[0].trim() };
  }

  const note = title && text && title !== text ? `${title}\n${text}` : title || text;
  return note ? { kind: "note", text: note } : { kind: "empty" };
}

const BASE = "http://retour.invalid";

// Adresse de retour après connexion, venue de l'URL donc forgeable : seul un
// chemin du site passe. « //ailleurs.com » et « /\ailleurs.com » sont lus par
// le navigateur comme un autre hôte, d'où la comparaison d'origine après
// résolution plutôt qu'un simple test du premier caractère.
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 4096 || !raw.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (url.pathname === "/login") return "/";
  return url.pathname + url.search + url.hash;
}

export function loginPath(returnTo: string): string {
  const safe = safeReturnPath(returnTo);
  return safe === "/" ? "/login" : `/login?suite=${encodeURIComponent(safe)}`;
}
