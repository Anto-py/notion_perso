// Aperçu d'un lien : lecture des métadonnées Open Graph d'une page. Module
// pur, séparé du réseau, pour que le parse se teste sans requête.
//
// Le serveur va chercher la page lui-même : une URL fournie par l'utilisateur
// pourrait viser le réseau interne du VPS (le service de métadonnées d'un
// hébergeur écoute souvent sur 169.254.169.254). isFetchableUrl refuse donc
// les adresses privées, avant l'envoi comme à chaque redirection.

export const UNFURL_TIMEOUT_MS = 6000;
export const UNFURL_MAX_BYTES = 512 * 1024;
export const UNFURL_MAX_REDIRECTS = 3;

const PRIVATE_HOSTS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/i,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

// Favicon servi par le site lui-même : aucun service tiers, donc aucune
// icône pour les pages qui n'en publient pas à cette adresse. Le composant
// retombe alors sur un glyphe.
export function faviconUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return new URL("/favicon.ico", url.origin).toString();
  } catch {
    return null;
  }
}

// Une URL que le serveur peut aller chercher : http(s), sans identifiants,
// avec un hôte public (un nom à point, ou une IP non privée).
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname;
  if (PRIVATE_HOSTS.some((pattern) => pattern.test(host))) return false;
  return host.includes(".") || host.startsWith("[");
}

// Attributs d'une balise, guillemets simples, doubles ou nus.
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of tag.matchAll(pattern)) found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return found;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity);
}

function clean(text: string | undefined, max: number): string {
  if (!text) return "";
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, max);
}

// site : la source affichée avant le titre (« ARTE », « Le Monde »), tirée de
// og:site_name. Vide quand la page n'en déclare pas.
export type Unfurled = { title: string; description: string; image: string | null; site: string };

// Titre, description et image d'une page. Priorité à Open Graph, puis à
// Twitter, puis aux balises classiques ; le titre retombe sur le domaine,
// comme le veut le cas « page protégée » du BRAINSTORMING.
export function parseUnfurl(html: string, url: string): Unfurled {
  // Une balise par source, puis arbitrage : l'ordre du document ne dit rien
  // de la priorité, seule la provenance compte.
  const meta: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content;
  }

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = meta["og:title"] ?? meta["twitter:title"] ?? titleTag;
  const description = meta["og:description"] ?? meta["twitter:description"] ?? meta["description"] ?? "";
  const image = meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? "";

  return {
    title: clean(title, 500) || domainOf(url),
    description: clean(description, 5000),
    image: image ? absolute(image, url) : null,
    site: clean(meta["og:site_name"], 100),
  };
}

function absolute(value: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(value).trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
