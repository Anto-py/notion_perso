"use client";
// Cellule de texte ou de lien du tableau. Au repos, une ligne, coupée si elle
// déborde ; un clic (ou Entrée) ouvre par-dessus la cellule un encadré au
// moins aussi large qu'elle, où le texte entier passe à la ligne et s'édite.
// Quitter l'encadré enregistre et le referme. Monté dans <body> en position
// fixe, comme le menu d'OptionPicker : ni la cellule ni le conteneur qui
// défile à l'horizontale ne le rognent.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Property, Value } from "@/lib/properties";
import { PropertyInput } from "./PropertyInput";
import { isWebUrl } from "./propertyUi";

type Props = {
  prop: Property;
  value: Value | undefined;
  onSave: (value: Value | null) => void;
};

type Box = { left: number; top: number; width: number; minHeight: number };

const MIN_WIDTH = 288;
const VIEWPORT_MARGIN = 12;

// Par-dessus la cellule, au moins aussi large qu'elle, sans sortir de l'écran.
function measure(trigger: HTMLElement | null): Box | null {
  const rect = trigger?.closest("td")?.getBoundingClientRect();
  if (!rect) return null;
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - 2 * VIEWPORT_MARGIN);
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
    top: rect.top,
    width,
    minHeight: rect.height,
  };
}

export function ExpandableCell({ prop, value, onSave }: Props) {
  const [box, setBox] = useState<Box | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const text = typeof value === "string" ? value : "";
  const open = box !== null;

  // L'encadré suit sa cellule quand la page ou le tableau défilent.
  useEffect(() => {
    if (!open) return;
    const follow = () => setBox(measure(trigger.current));
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  return (
    <span className="cell-expandable">
      <button ref={trigger} type="button" className="cell-preview" aria-label={`${prop.name} : modifier`} aria-expanded={open} onClick={() => setBox(measure(trigger.current))}>
        {text || <span className="empty-value">Vide</span>}
      </button>
      {prop.type === "url" && isWebUrl(text) && (
        <a href={text} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${prop.name}`}>
          ↗
        </a>
      )}
      {box &&
        createPortal(
          <div
            className="cell-overlay"
            style={box}
            // Un événement d'un portail remonte l'arbre React jusqu'à la ligne,
            // dont le clic ouvrirait l'entrée.
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setBox(null);
              // Entrée ou Échap : le clavier revient à la cellule.
              if (!event.relatedTarget) trigger.current?.focus();
            }}
          >
            <PropertyInput prop={prop} value={value} onSave={onSave} onCreate={async () => null} onCreateEntry={async () => null} focusAtEnd />
          </div>,
          document.body,
        )}
    </span>
  );
}
