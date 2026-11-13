"use client";
// Carte de confirmation d'un déplacement de bloc qui change ce que le public
// peut lire (lib/block_move_share.ts). Le serveur a refusé d'écrire sans accord
// et rendu les phrases : on les montre, et le geste ne repart qu'avec « Déplacer
// quand même ». Le focus tombe sur « Annuler » : un Entrée distrait ne publie
// rien. Montée dans <body> sous le bloc, comme PagePicker.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  anchor: HTMLElement;
  warnings: readonly string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const CARD_WIDTH = 420;
const VIEWPORT_MARGIN = 12;

export function BlockMoveConfirm({ anchor, warnings, busy, onConfirm, onCancel }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());

  useEffect(() => {
    const follow = () => setRect(anchor.getBoundingClientRect());
    const closeOut = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) onCancel();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    document.addEventListener("pointerdown", closeOut);
    document.addEventListener("keydown", onKey);
    // Le menu de la poignée rend le focus à l'éditeur en se fermant : le bouton le reprend juste après.
    const focus = setTimeout(() => cancelButton.current?.focus(), 0);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("pointerdown", closeOut);
      document.removeEventListener("keydown", onKey);
      clearTimeout(focus);
    };
  }, [anchor, onCancel]);

  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
  const above = rect.bottom > window.innerHeight * 0.6;
  const style = {
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
    top: above ? rect.top - 4 : rect.bottom + 4,
    width,
    transform: above ? "translateY(-100%)" : undefined,
  };

  return createPortal(
    <div
      ref={card}
      role="alertdialog"
      aria-label="Confirmer le déplacement du bloc"
      className="picker-menu picker-menu-fixed block-move-confirm"
      style={style}
    >
      <p className="block-move-confirm-title">Ce déplacement change ce que le public peut lire</p>
      <ul>
        {warnings.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="block-move-confirm-actions">
        <button ref={cancelButton} type="button" className="ghost" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "Déplacement…" : "Déplacer quand même"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
