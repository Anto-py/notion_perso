// Position du pointeur pendant un glisser dnd-kit, et côté d'une cible visé.
// On saisit une carte par sa poignée, en haut à gauche : le centre de la carte
// tirée est alors bien plus bas que le pointeur, et juger « avant ou après »
// sur ce centre rend la première place inatteignable. Le pointeur, lui, dit
// où l'on vise. Module pur, testé sans DOM.

export type Point = { x: number; y: number };

type Touchy = { clientX?: unknown; clientY?: unknown; touches?: ArrayLike<{ clientX: number; clientY: number }> };

// Point d'appui du geste (souris ou premier doigt) décalé du déplacement
// accumulé. Null quand l'événement d'origine n'en porte pas (clavier).
export function pointerAt(activator: unknown, delta: { x: number; y: number }): Point | null {
  if (typeof activator !== "object" || activator === null) return null;
  const event = activator as Touchy;
  const touch = event.touches && event.touches.length > 0 ? event.touches[0] : undefined;
  const x = touch ? touch.clientX : event.clientX;
  const y = touch ? touch.clientY : event.clientY;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x + delta.x, y: y + delta.y };
}

// Vrai quand la position tombe avant le milieu de la cible sur cet axe.
export function isBeforeMiddle(position: number, start: number, size: number): boolean {
  return position < start + size / 2;
}
