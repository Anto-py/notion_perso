import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image de production : un serveur autonome, sans node_modules complet
  // (voir Dockerfile, cible runner).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Le service worker se relit à chaque visite : une version en cache
  // retarderait d'un jour toute correction (guide PWA de Next).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      // La vitrine n'est jamais indexée. Ses métadonnées arrivent en flux à la
      // fin du <body> (rendu dynamique) : l'en-tête ne dépend pas de ce flux.
      {
        source: "/veille",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
