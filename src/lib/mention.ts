// Mention : un contenu en ligne BlockNote qui tient une adresse et son titre.
// Module pur, partagé par la capture, l'éditeur et le rendu HTML.
import { siteHost } from "./site_host";

export type Mention = { url: string; title: string };

// Les propriétés d'une mention arrivée du navigateur : on ignore tout le
// reste, une adresse vide ne fait pas une mention.
export function mentionProps(raw: unknown): Mention | null {
  if (typeof raw !== "object" || raw === null) return null;
  const props = raw as Record<string, unknown>;
  const url = typeof props.url === "string" ? props.url.trim() : "";
  if (!url) return null;
  const title = typeof props.title === "string" ? props.title.trim() : "";
  return { url, title };
}

export function mentionNode(url: string, title: string): Record<string, unknown> {
  return { type: "mention", props: { url, title } };
}

// Hôte dont l'icône sert une mention : null pour une adresse qui n'est pas
// http(s) ou dont l'hôte ne peut pas nommer un fichier de cache.
export function mentionHost(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return siteHost(url.hostname);
  } catch {
    return null;
  }
}

// Icône d'une mention, servie par l'instance (étape 22) : le navigateur du
// lecteur, visiteur public compris, ne demande jamais l'icône au site.
export function mentionIconUrl(raw: string): string | null {
  const host = mentionHost(raw);
  return host ? `/api/favicon/${host}` : null;
}

// Hôtes cités par les mentions des pages de la portée publique : les seuls
// favicons servis sans session (app/api/favicon/[host]). pages : id et
// adresses citées, à toute profondeur du corps.
export function hostsOfMentions(pages: readonly { id: string; urls: readonly string[] }[], reach: ReadonlySet<string>): Set<string> {
  const hosts = new Set<string>();
  for (const page of pages) {
    if (!reach.has(page.id)) continue;
    for (const url of page.urls) {
      const host = mentionHost(url);
      if (host) hosts.add(host);
    }
  }
  return hosts;
}
