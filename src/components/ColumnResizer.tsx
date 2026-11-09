"use client";
// Poignée de largeur au bord droit d'un en-tête de colonne : glisser pour
// régler, double-clic ou Entrée pour ajuster au contenu, flèches gauche et
// droite au clavier. Événements pointeur natifs plutôt qu'un troisième
// glisser dnd-kit : la poignée voisine ⠿ déplace la colonne, les deux gestes
// ne doivent pas entrer en collision.
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clampColumnWidth, COLUMN_WIDTH_LIMITS } from "@/lib/views";

type Props = {
  label: string;
  width: number | undefined;
  // Largeur choisie, envoyée au relâchement du pointeur ; un délai regroupe
  // les frappes du clavier en une seule écriture.
  onResize: (width: number, delay?: number) => void;
  // Largeur vivante pendant le glissement, sans écriture ; null le termine.
  onPreview: (width: number | null) => void;
  // Largeur qui montre tout le contenu, ou null si la mesure échoue.
  onAutoFit: () => number | null;
};

export function ColumnResizer({ label, width, onResize, onPreview, onAutoFit }: Props) {
  const handle = useRef<HTMLSpanElement | null>(null);

  // Largeur actuelle de la colonne, lue sur l'en-tête : la valeur mémorisée
  // peut manquer tant que la colonne n'a jamais été réglée.
  function measuredWidth(): number {
    const cell = handle.current?.closest("th");
    return Math.round(cell?.getBoundingClientRect().width ?? width ?? COLUMN_WIDTH_LIMITS.min);
  }

  function startDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    const node = event.currentTarget;
    const startX = event.clientX;
    const startWidth = measuredWidth();
    let last = startWidth;
    document.body.classList.add("col-resizing");
    node.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      last = clampColumnWidth(startWidth + moveEvent.clientX - startX);
      onPreview(last);
    };
    const finish = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", finish);
      node.removeEventListener("pointercancel", finish);
      document.body.classList.remove("col-resizing");
      onPreview(null);
      if (last !== startWidth) onResize(last);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", finish);
  }

  function fit() {
    const next = onAutoFit();
    if (next !== null) onResize(next);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      fit();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const next = measuredWidth() + (event.key === "ArrowRight" ? step : -step);
    onResize(clampColumnWidth(next), 250);
  }

  return (
    <span
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largeur de la colonne ${label} (flèches gauche et droite, Entrée pour ajuster)`}
      aria-valuemin={COLUMN_WIDTH_LIMITS.min}
      aria-valuemax={COLUMN_WIDTH_LIMITS.max}
      aria-valuenow={width}
      tabIndex={0}
      className="col-resize"
      onPointerDown={startDrag}
      onDoubleClick={fit}
      onKeyDown={onKeyDown}
    />
  );
}
