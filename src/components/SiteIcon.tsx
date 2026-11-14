"use client";
// Favicon lu par le serveur de l'instance (étape 22), avec repli sur un globe.
// Le navigateur ne demande jamais l'icône au site : ni en privé, ni sur une
// page publiée. Une icône absente ou illisible déclenche onError. L'état évite
// de relancer la requête à chaque rendu.
import { useState } from "react";
import { mentionIconUrl } from "@/lib/mention";

export function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = mentionIconUrl(url);
  if (!src || failed) return <span className="inbox-glyph">🌐</span>;
  return (
    // L'hôte est arbitraire : next/image exigerait de déclarer chaque domaine,
    // et son optimisation n'a rien à gagner sur une icône de 16 px.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="inbox-favicon" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />
  );
}
