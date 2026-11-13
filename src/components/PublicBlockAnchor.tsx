"use client";
// Lien `#<bloc>` sur une page publiée ou une sauvegarde (étape 21, palier d). Le
// navigateur défile seul vers un id… s'il le trouve en lisant le HTML. Le corps
// arrive dans un second morceau du flux (Suspense), inséré par script : selon
// l'ordre d'arrivée, le défilement natif a déjà renoncé. Rendu avec le corps, cet
// îlot s'hydrate après lui et refait le défilement. Le surlignage reste au CSS
// (`.public-body :target`), qui suit l'adresse et n'a pas ce problème.
import { useEffect } from "react";
import { blockIdFromHash } from "@/lib/block_link";

export function PublicBlockAnchor() {
  useEffect(() => {
    const reveal = () => {
      const id = blockIdFromHash(window.location.hash);
      const element = id ? document.getElementById(id) : null;
      if (!element) return;
      // Déjà dans le haut de la fenêtre : le navigateur a fait son travail, ou la
      // personne a déjà défilé jusque-là.
      const top = element.getBoundingClientRect().top;
      if (top >= 0 && top < window.innerHeight / 2) return;
      // `scroll-margin-top` (globals.css) pose le bloc au quart de la fenêtre.
      element.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return null;
}
