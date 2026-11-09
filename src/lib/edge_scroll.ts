// Défilement automatique pendant un glisser : vitesse verticale, en pixels par
// image, selon la distance du pointeur au bord haut ou bas de la vue. Le
// glisser natif de BlockNote n'en a aucun ; dnd-kit le fait par lui-même.
// Module pur, testé sans DOM.

// Bande d'accroche au bord, en pixels, et vitesse maximale par image.
export const EDGE_SCROLL_BAND = 96;
export const EDGE_SCROLL_MAX = 14;

// Négatif vers le haut, positif vers le bas, zéro hors de la bande. La vitesse
// croît avec la profondeur dans la bande ; un pointeur sorti de la vue garde la
// vitesse maximale.
export function edgeScrollVelocity(
  clientY: number,
  viewportHeight: number,
  band = EDGE_SCROLL_BAND,
  max = EDGE_SCROLL_MAX,
): number {
  if (!(band > 0) || !(max > 0)) return 0;
  if (clientY < band) {
    const depth = Math.min(1, (band - clientY) / band);
    return -Math.ceil(max * depth);
  }
  const bottom = viewportHeight - band;
  if (clientY > bottom) {
    const depth = Math.min(1, (clientY - bottom) / band);
    return Math.ceil(max * depth);
  }
  return 0;
}
