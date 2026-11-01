// Récupération d'un aperçu de lien : le fetch et ses garde-fous. Les règles
// d'URL et le parse des métadonnées sont dans unfurl.ts (pur, testé).
import {
  domainOf,
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

const USER_AGENT = "Mozilla/5.0 (compatible; notion_perso/1.0; +https://github.com/Anto-py/notion_perso)";

function fallback(raw: string): Unfurled {
  return { title: domainOf(raw), description: "", image: null, site: "" };
}

// YouTube sert un mur de consentement à un serveur sans cookies. oEmbed, lui,
// donne le titre et l'auteur sans détour. En cas d'échec, on retombe sur la
// page ordinaire, qui donnera au moins le domaine.
async function youtubePreview(raw: string): Promise<Unfurled | null> {
  const id = youtubeId(raw);
  if (!id) return null;
  try {
    const response = await fetch(youtubeOEmbedUrl(id), {
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
export async function unfurl(raw: string): Promise<Unfurled> {
  if (!isFetchableUrl(raw)) return fallback(raw);
  // Vidéo publique : oEmbed donne titre et auteur. Vidéo privée ou retirée :
  // il répond 403 et la page HTML ne donne qu'un mur de consentement, d'où le
  // repli direct sur le domaine plutôt qu'un titre « youtube.com » trompeur.
  if (youtubeId(raw)) return (await youtubePreview(raw)) ?? fallback(raw);
  let current = raw;
  try {
    for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop++) {
      const response = await fetch(current, {
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
        if (!isFetchableUrl(next)) return fallback(raw);
        current = next;
        continue;
      }
      if (!response.ok) return fallback(raw);
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("text/html") && !type.includes("application/xhtml")) return fallback(raw);
      return parseUnfurl(await readLimited(response), current);
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
// sans bandeau plutôt que d'échouer.
export async function fetchRemoteImage(raw: string): Promise<RemoteImage | null> {
  if (!isFetchableUrl(raw)) return null;
  let current = raw;
  try {
    for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop++) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "image/*" },
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        const next = new URL(location, current).toString();
        if (!isFetchableUrl(next)) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = IMAGE_TYPES[mime];
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
