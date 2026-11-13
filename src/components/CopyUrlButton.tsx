"use client";
// Bouton « Copier » d'une cellule Lien dans une vue publique, en lecture seule
// (aussi « Copier le lien » de la vitrine, par `label`).
// Au survol ou au focus clavier, il copie l'adresse complète et « Copié » le
// confirme un instant. Repli sur un champ temporaire quand l'API presse-papiers
// n'est pas disponible (contexte non sécurisé, navigateur ancien).
import { useEffect, useRef, useState } from "react";
import { copyText } from "./copy_text";

type CopyState = "idle" | "copied" | "failed";

export function CopyUrlButton({ url, label = "Copier" }: { url: string; label?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const ok = await copyText(url);
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
      {state === "copied" ? "Copié" : state === "failed" ? "Échec" : label}
    </button>
  );
}
