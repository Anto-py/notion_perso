// Récupération d'un aperçu de lien : le fetch et ses garde-fous. Les règles
// d'URL et le parse des métadonnées sont dans unfurl.ts (pur, testé).
//
// Toute requête part par le fetch d'undici (version épinglée, cf. SPECS « Garde
// DNS ») avec un Agent dont la résolution refuse les adresses privées : le
// contrôle a lieu à la connexion, là où un nom public qui résout vers le réseau
// interne ne peut plus passer entre deux résolutions.
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";
import { isPrivateHost, safeLookup } from "./safe_lookup";
import {
  domainOf,
  faviconUrl,
  isFetchableUrl,
  parseUnfurl,
  UNFURL_MAX_BYTES,
  UNFURL_MAX_REDIRECTS,
  UNFURL_TIMEOUT_MS,
  type Unfurled,
} from "./unfurl";
import { ALLOWED_TYPES } from "./upload_rules";
import { youtubeId, youtubeOEmbedUrl } from "./youtube";

// Image Open Graph d'un lien capturé (BRAINSTORMING §5) : même borne qu'un
// bandeau téléversé, et mêmes types admis que le dépôt de fichiers.
export const UNFURL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export type RemoteImage = { bytes: Uint8Array<ArrayBuffer>; mime: string; ext: string };

const IMAGE_TYPES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ALLOWED_TYPES).filter(([type]) => type.startsWith("image/")),
);

// Icônes de site, admises seulement sur demande (logos de la vitrine) : jamais
// de SVG, qui peut porter du script.
const ICON_TYPES: Readonly<Record<string, string>> = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const USER_AGENT = "Mozilla/5.0 (compatible; notion_perso/1.0; +https://github.com/Anto-py/notion_perso)";

const guarded = new Agent({ connect: { lookup: safeLookup } });

// Une URL que le serveur peut ouvrir : règles d'unfurl.ts, plus le refus d'une
// adresse IP privée écrite telle quelle (Node la connecte sans passer par le
// DNS, donc sans safeLookup).
function canFetch(raw: string): boolean {
  if (!isFetchableUrl(raw)) return false;
  return !isPrivateHost(new URL(raw).hostname);
}

function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: guarded });
}

// reached : la page a répondu 2xx, quel qu'en soit le type. Sert à la vitrine
// pour refuser un lien proposé injoignable ; le reste de l'app ne lit que
// l'aperçu.
export type UnfurlResult = Unfurled & { reached: boolean };

function fallback(raw: string, reached = false): UnfurlResult {
  return { title: domainOf(raw), description: "", image: null, site: "", icon: faviconUrl(raw), reached };
}

// YouTube sert un mur de consentement à un serveur sans cookies. oEmbed, lui,
// donne le titre et l'auteur sans détour. En cas d'échec, on retombe sur la
// page ordinaire, qui donnera au moins le domaine.
async function youtubePreview(raw: string): Promise<UnfurlResult | null> {
  const id = youtubeId(raw);
  if (!id) return null;
  try {
    const response = await guardedFetch(youtubeOEmbedUrl(id), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.title !== "string" || data.title.trim() === "") return null;
    return {
      title: data.title.slice(0, 500),
      description: "",
      image: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
      site: typeof data.author_name === "string" ? data.author_name.slice(0, 100) : "",
      icon: faviconUrl("https://www.youtube.com"),
      reached: true,
    };
  } catch {
    return null;
  }
}

// Corps lu au plus UNFURL_MAX_BYTES : une page de plusieurs dizaines de Mo
// n'a pas à tenir en mémoire pour lire un titre.
async function readLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < UNFURL_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, UNFURL_MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return new TextDecoder().decode(bytes);
}

// Titre, description et image d'une page. Toute panne (réseau, délai, page
// protégée, format inattendu) donne le repli du BRAINSTORMING : le domaine
// comme titre, l'URL restant de toute façon enregistrée par l'appelant.
export async function unfurl(raw: string): Promise<UnfurlResult> {
  if (!canFetch(raw)) return fallback(raw);
  // Vidéo publique : oEmbed donne titre et auteur. Vidéo privée ou retirée :
  // il répond 403 et la page HTML ne donne qu'un mur de consentement, d'où le
  // repli direct sur le domaine plutôt qu'un titre « youtube.com » trompeur.
  if (youtubeId(raw)) return (await youtubePreview(raw)) ?? fallback(raw);
  let current = raw;
  try {
    for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop++) {
      const response = await guardedFetch(current, {
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return fallback(raw);
        const next = new URL(location, current).toString();
        if (!canFetch(next)) return fallback(raw);
        current = next;
        continue;
      }
      if (!response.ok) return fallback(raw);
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("text/html") && !type.includes("application/xhtml")) {
        await response.body?.cancel().catch(() => {});
        return fallback(raw, true);
      }
      return { ...parseUnfurl(await readLimited(response), current), reached: true };
    }
  } catch {
    return fallback(raw);
  }
  return fallback(raw);
}

// Corps d'une image lu au plus `limit` octets ; null dès le dépassement, sans
// garder le surplus.
async function readBytesLimited(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Téléchargement de l'image Open Graph d'un lien capturé : mêmes gardes que la
// page elle-même (schéma, adresse privée revérifiée à chaque redirection),
// image seulement, 5 Mo au plus. Toute panne rend null : la capture se fait
// sans bandeau plutôt que d'échouer. allowIcon admet en plus les .ico (logos
// de la vitrine).
export async function fetchRemoteImage(raw: string, options: { allowIcon?: boolean } = {}): Promise<RemoteImage | null> {
  if (!canFetch(raw)) return null;
  let current = raw;
  try {
    for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop++) {
      const response = await guardedFetch(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "image/*" },
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        const next = new URL(location, current).toString();
        if (!canFetch(next)) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = IMAGE_TYPES[mime] ?? (options.allowIcon ? ICON_TYPES[mime] : undefined);
      if (!ext) return null;
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > UNFURL_IMAGE_MAX_BYTES) return null;
      const bytes = await readBytesLimited(response, UNFURL_IMAGE_MAX_BYTES);
      return bytes ? { bytes, mime, ext } : null;
    }
  } catch {
    return null;
  }
  return null;
}
