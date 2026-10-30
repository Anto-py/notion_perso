import type { MetadataRoute } from "next";

// Manifeste de la PWA, servi à /manifest.webmanifest (convention de Next).
// Le partage natif part en GET vers /share : tout tient dans l'adresse, qui
// survit à une reconnexion, là où le corps d'un POST se perdrait.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "notion_perso",
    short_name: "notion_perso",
    description: "Pages, bases et veille, auto-hébergées",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2efe6",
    theme_color: "#f2efe6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      // Sans effet en GET, mais Chrome signale son absence à la lecture.
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
