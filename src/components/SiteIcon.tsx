"use client";
// Favicon servi par le site, avec repli sur un globe. Beaucoup de pages n'en
// publient pas à /favicon.ico, et une réponse 200 peut contenir du HTML : un
// échec de décodage déclenche aussi onError. L'état évite de relancer la
// requête à chaque rendu.
import { useState } from "react";
import { faviconUrl } from "@/lib/unfurl";

export function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  if (!src || failed) return <span className="inbox-glyph">🌐</span>;
  return (
    // L'hôte est arbitraire : next/image exigerait de déclarer chaque domaine,
    // et son optimisation n'a rien à gagner sur une icône de 16 px.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="inbox-favicon" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />
  );
}
