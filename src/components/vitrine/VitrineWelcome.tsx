"use client";
// Mot d'accueil de la vitrine (§10) : corps de la page choisie, rendu au
// serveur par renderHtml avec les liens de la vitrine (HTML déjà échappé).
// Replié à 4 lignes par le CSS dès le rendu serveur ; « Lire la suite »
// n'apparaît que si le texte dépasse, mesuré par un ResizeObserver.
import { useEffect, useRef, useState } from "react";

export function VitrineWelcome({ html }: { html: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const node = body.current;
    // Déplié, le texte ne dépasse plus : la mesure garderait « Réduire » caché.
    if (!node || open) return;
    const observer = new ResizeObserver(() => setOverflows(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div className="vitrine-welcome-wrap">
      <div
        ref={body}
        id="vitrine-welcome"
        className="vitrine-welcome public-body"
        data-open={open || undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflows || open ? (
        <button
          type="button"
          className="vitrine-more"
          aria-expanded={open}
          aria-controls="vitrine-welcome"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Réduire" : "Lire la suite"}
        </button>
      ) : null}
    </div>
  );
}
