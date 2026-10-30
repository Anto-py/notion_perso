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
import { youtubeId, youtubeOEmbedUrl } from "./youtube";

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
          "user-agent": "Mozilla/5.0 (compatible; notion_perso/1.0; +https://github.com/Anto-py/notion_perso)",
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
