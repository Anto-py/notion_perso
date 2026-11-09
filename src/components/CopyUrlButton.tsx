"use client";
// Bouton « Copier » d'une cellule Lien dans une vue publique, en lecture seule.
// Au survol ou au focus clavier, il copie l'adresse complète et « Copié » le
// confirme un instant. Repli sur un champ temporaire quand l'API presse-papiers
// n'est pas disponible (contexte non sécurisé, navigateur ancien).
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function CopyUrlButton({ url }: { url: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = legacyCopy(url);
    }
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      className="copy-url"
      aria-label={`Copier l’adresse ${url}`}
      data-state={state}
      onClick={copy}
    >
      {state === "copied" ? "Copié" : state === "failed" ? "Échec" : "Copier"}
    </button>
  );
}

// Repli : un champ hors écran, sélectionné, copié par la commande du navigateur.
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}
