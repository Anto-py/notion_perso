"use client";
// Déposer une page de l'arbre dans le corps de la page ouverte. Le glisser
// appartient à la barre latérale (dnd-kit), l'éditeur est hors de son
// contexte : la barre suit le pointeur et parle à l'éditeur par deux
// événements, le survol (trait d'insertion) et le dépôt (bloc posé). Le
// conteneur de l'éditeur porte data-drop-page quand sa page accepte des
// sous-pages (une entrée de base n'en a pas).
export type DropPoint = { x: number; y: number };
export type EditorHover = { hostId: string; point: DropPoint } | null;
export type EditorDrop = { hostId: string; pageId: string; point: DropPoint };
// Bloc de référence, côté où poser le nouveau bloc, et trait à tracer, en
// coordonnées du conteneur de l'éditeur.
export type DropSpot = { blockId: string; placement: "before" | "after"; top: number; left: number; width: number };

const HOVER = "np:editor-drop-hover";
const DROP = "np:editor-drop";

// Un bloc ordinaire, ou une rangée de colonnes prise entière : jamais une
// colonne seule, où une sous-page ne peut pas se ranger en sœur.
const BLOCK = '[data-node-type="blockContainer"][data-id], [data-node-type="columnList"][data-id]';

export function announceEditorHover(hover: EditorHover): void {
  window.dispatchEvent(new CustomEvent<EditorHover>(HOVER, { detail: hover }));
}

export function announceEditorDrop(drop: EditorDrop): void {
  window.dispatchEvent(new CustomEvent<EditorDrop>(DROP, { detail: drop }));
}

function listen<T>(name: string, listener: (detail: T) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<T>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

export const onEditorHover = (listener: (hover: EditorHover) => void) => listen(HOVER, listener);
export const onEditorDrop = (listener: (drop: EditorDrop) => void) => listen(DROP, listener);

// Position d'un événement souris ou doigt, en coordonnées de la fenêtre.
export function pointOf(event: Event | null): DropPoint | null {
  if (!event) return null;
  if ("touches" in event) {
    const touch = (event as TouchEvent).touches[0] ?? (event as TouchEvent).changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if ("clientX" in event) return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  return null;
}

// elementsFromPoint, et non elementFromPoint : la vignette de glisser suit le
// pointeur et masquerait ce qu'il y a dessous.
export function dropHostAt(point: DropPoint): HTMLElement | null {
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    const host = element.closest<HTMLElement>("[data-drop-page]");
    if (host) return host;
  }
  return null;
}

function blockUnder(host: HTMLElement, point: DropPoint): HTMLElement | null {
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    if (!host.contains(element)) continue;
    const block = element.closest<HTMLElement>(BLOCK);
    if (block && host.contains(block)) return block;
  }
  return null;
}

// Pointeur dans une marge (à gauche des blocs, sous le dernier) : le bloc de
// premier niveau le plus proche en hauteur.
function nearestTopBlock(host: HTMLElement, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const block of host.querySelectorAll<HTMLElement>(BLOCK)) {
    if (block.parentElement?.closest(BLOCK)) continue;
    const rect = block.getBoundingClientRect();
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }
  return best;
}

export function dropSpot(host: HTMLElement, point: DropPoint): DropSpot | null {
  const block = blockUnder(host, point) ?? nearestTopBlock(host, point.y);
  const blockId = block?.dataset.id;
  if (!block || !blockId) return null;
  // La moitié se lit sur le contenu propre du bloc, sans ses enfants : un
  // dépliant ouvert ne doit pas repousser la frontière tout en bas.
  const own = (block.querySelector(":scope > .bn-block-content") ?? block).getBoundingClientRect();
  const whole = block.getBoundingClientRect();
  const placement = point.y < own.top + own.height / 2 ? "before" : "after";
  const origin = host.getBoundingClientRect();
  return {
    blockId,
    placement,
    top: (placement === "before" ? whole.top : whole.bottom) - origin.top,
    left: whole.left - origin.left,
    width: whole.width,
  };
}
