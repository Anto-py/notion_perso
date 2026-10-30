// Reconnaît une URL YouTube et en tire l'identifiant de vidéo. On n'intègre
// jamais l'URL telle quelle : l'iframe pointe vers youtube-nocookie.com, avec
// un identifiant vérifié, ce qui ferme la porte à toute URL piégée.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

export function youtubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  let id: string | null = null;
  if (url.hostname === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      id = match ? match[1] : null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
