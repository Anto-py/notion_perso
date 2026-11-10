// Logos de la vitrine (BRAINSTORMING de la vitrine, §12) : règles pures. Le
// réseau et le disque sont dans vitrine_logo_store.ts, la route dans
// app/api/veille/logo/[host].
//
// La route ne visite jamais un site choisi par le visiteur : l'hôte demandé
// doit être celui du Site Web d'une entrée de la vitrine (logoTarget), et seule
// la page d'accueil de ce site est lue.
import { attributes, decodeEntities } from "./unfurl";
import { hostOf, parseSite } from "./vitrine";

// Sous-dossier d'UPLOAD_DIR, hors table media : le balayage des médias ne le
// voit pas.
export const LOGO_DIR = "vitrine_logos";
const DAY_MS = 24 * 60 * 60 * 1000;
// Un logo (ou une absence) est relu après 30 jours, pour suivre un changement.
export const LOGO_FRESH_MS = 30 * DAY_MS;
// Extension du fichier vide qui note une absence de logo.
export const LOGO_NONE = "none";

// Formats servis, par extension : ceux de fetchRemoteImage avec allowIcon.
// Jamais de SVG, qui peut porter du script.
export const LOGO_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Nom d'hôte demandé à la route, en minuscules ; null s'il n'est pas un nom de
// domaine à point (ni chemin, ni port, ni IP v6). Sert aussi de nom de
// fichier : seuls lettres, chiffres, points et tirets y passent.
export function logoHost(raw: string): string | null {
  const host = raw.toLowerCase();
  if (host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  // Un domaine de premier niveau a au moins une lettre : « 127.0.0.1 » n'en est pas un.
  return /[a-z]/.test(labels[labels.length - 1]) ? host : null;
}

// Page d'accueil à lire pour l'hôte demandé : origine du premier Site Web de
// la base dont l'hôte (sans www) est celui-là, null sinon.
export function logoTarget(host: string, sites: readonly (string | null)[]): string | null {
  for (const raw of sites) {
    const url = raw ? parseSite(raw) : null;
    if (url && hostOf(url) === host) return `${url.origin}/`;
  }
  return null;
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(href).trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Plus grand côté déclaré par sizes (« 32x32 16x16 » → 32) ; 0 sans taille
// lisible (« any », absent).
function largestSize(sizes: string | undefined): number {
  let best = 0;
  for (const match of (sizes ?? "").matchAll(/(\d+)x(\d+)/gi)) best = Math.max(best, Number(match[1]), Number(match[2]));
  return best;
}

function isSvg(attrs: Record<string, string>, url: string): boolean {
  return (attrs.type ?? "").toLowerCase().includes("svg") || new URL(url).pathname.toLowerCase().endsWith(".svg");
}

type Candidate = { url: string; size: number; order: number };

const bySize = (a: Candidate, b: Candidate) => b.size - a.size || a.order - b.order;

// Adresses à essayer dans l'ordre : apple-touch-icon (la plus grande d'abord),
// puis les icônes déclarées par taille décroissante, puis /favicon.ico du site.
// pageUrl : adresse finale de la page, redirections suivies.
export function logoCandidates(html: string, pageUrl: string): string[] {
  const apple: Candidate[] = [];
  const icons: Candidate[] = [];
  let order = 0;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const isApple = rel.some((token) => token.startsWith("apple-touch-icon"));
    if (!isApple && !rel.includes("icon")) continue;
    const url = attrs.href ? absolute(attrs.href, pageUrl) : null;
    if (!url || isSvg(attrs, url)) continue;
    (isApple ? apple : icons).push({ url, size: largestSize(attrs.sizes), order: order++ });
  }
  const urls = [...apple.sort(bySize), ...icons.sort(bySize)].map((candidate) => candidate.url);
  urls.push(new URL("/favicon.ico", pageUrl).toString());
  return [...new Set(urls)];
}

export function logoFresh(mtimeMs: number, now: number): boolean {
  return now - mtimeMs < LOGO_FRESH_MS;
}
