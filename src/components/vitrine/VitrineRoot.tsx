"use client";

// Racine de la vitrine (§13). Le fond Art nouveau n'est demandé qu'après le
// contenu : la page est streamée, la mise en page (donc VitrineRoot) s'hydrate
// avant que les cartes n'arrivent. Le signal vient de VitrineFond, rendu dans
// la partie streamée après le contenu, quand le navigateur est au repos ; la
// classe vitrine-fond, qui porte l'image (vitrine.css), n'existe jamais sans
// JavaScript.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const FondContext = createContext<() => void>(() => {});

export function VitrineRoot({ children }: { children: ReactNode }) {
  const [fond, setFond] = useState(false);
  // Identité stable : l'effet de VitrineFond ne se relance pas au rendu suivant.
  const show = useCallback(() => setFond(true), []);
  return (
    <FondContext value={show}>
      <div className={fond ? "vitrine vitrine-fond" : "vitrine"}>{children}</div>
    </FondContext>
  );
}

export function VitrineFond() {
  const show = useContext(FondContext);

  useEffect(() => {
    // Safari n'a pas toujours requestIdleCallback : un court délai le remplace.
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(show, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    // Hors du test sur window, que TypeScript réduit ici à never.
    const handle = setTimeout(show, 300);
    return () => clearTimeout(handle);
  }, [show]);

  return null;
}
