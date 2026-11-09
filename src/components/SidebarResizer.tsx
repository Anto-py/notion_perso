"use client";
// Poignée de largeur au bord droit de la barre latérale : glisser pour régler,
// double-clic ou Entrée pour revenir à 260 px, flèches gauche et droite au
// clavier. Même geste que la poignée d'une colonne, sans dnd-kit.
import { useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { SIDEBAR_DEFAULT, SIDEBAR_LIMITS, clampSidebarWidth } from "@/lib/sidebar";
import { getServerSnapshot, getSnapshot, resetSidebarWidth, setSidebarWidth, subscribe } from "./sidebar_store";

export function SidebarResizer() {
  const { width } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const handle = useRef<HTMLSpanElement | null>(null);

  // La largeur réellement affichée, qui peut précéder la reprise de l'état.
  function measuredWidth(): number {
    const aside = handle.current?.closest(".sidebar");
    return Math.round(aside?.getBoundingClientRect().width ?? width);
  }

  function startDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    const node = event.currentTarget;
    const startX = event.clientX;
    const startWidth = measuredWidth();
    let last = startWidth;
    document.body.classList.add("sidebar-resizing");
    node.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      last = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setSidebarWidth(last, false);
    };
    const finish = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", finish);
      node.removeEventListener("pointercancel", finish);
      document.body.classList.remove("sidebar-resizing");
      setSidebarWidth(last, true);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", finish);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      resetSidebarWidth();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const next = measuredWidth() + (event.key === "ArrowRight" ? step : -step);
    setSidebarWidth(next, true);
  }

  return (
    <span
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largeur de la barre latérale (flèches gauche et droite, Entrée pour revenir à ${SIDEBAR_DEFAULT.width} px)`}
      aria-valuemin={SIDEBAR_LIMITS.min}
      aria-valuemax={SIDEBAR_LIMITS.max}
      aria-valuenow={width}
      tabIndex={0}
      className="sidebar-resizer"
      onPointerDown={startDrag}
      onDoubleClick={resetSidebarWidth}
      onKeyDown={onKeyDown}
    />
  );
}
