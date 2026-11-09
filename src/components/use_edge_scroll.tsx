"use client";
// Défilement de la fenêtre quand un bloc BlockNote est glissé près du bord haut
// ou bas de la vue. Le glisser natif du menu latéral de BlockNote n'en a
// aucun ; les vues dnd-kit ont le leur, réglé par la bibliothèque.
import { useEffect, type RefObject } from "react";
import { edgeScrollVelocity } from "@/lib/edge_scroll";

// Les poignées qui déclenchent un glisser de bloc : menu latéral et poignées de
// tableau de BlockNote, toutes deux en glisser natif.
const HANDLES = ".bn-side-menu, .bn-table-handle";

export function useEdgeScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    let active = false;
    let speed = 0;
    let frame = 0;

    const tick = () => {
      if (!active) {
        frame = 0;
        return;
      }
      if (speed !== 0) window.scrollBy(0, speed);
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (active) return;
      active = true;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      active = false;
      speed = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onDragStart = (event: DragEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(HANDLES)) start();
    };
    const onDragOver = (event: DragEvent) => {
      if (active) speed = edgeScrollVelocity(event.clientY, window.innerHeight);
    };

    host.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    return () => {
      stop();
      host.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };
  }, [ref]);
}
