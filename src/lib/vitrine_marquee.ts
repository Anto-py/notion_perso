// Défilement continu des rangées « Coups de cœur » et « Ajoutés récemment ».
// La piste porte deux fois ses cartes : arrivée au bout du premier jeu, elle
// recule d'une période (la largeur d'un jeu), ce que l'œil ne voit pas. Une
// vitesse négative fait défiler dans l'autre sens : sous zéro, la piste saute
// au même endroit de la copie.

// Vitesse, en pixels par seconde : une carte de 17 rem passe en une dizaine
// de secondes.
export const MARQUEE_SPEED = 24;

// Pause après un geste du visiteur (molette, doigt, flèche, clavier).
export const MARQUEE_HOLD_MS = 4000;

// Au-delà, le temps écoulé est plafonné : au retour d'un onglet resté en
// arrière-plan, la rangée ne fait pas de bond.
const MAX_ELAPSED_MS = 100;

export function marqueeStep(position: number, elapsedMs: number, period: number, speed = MARQUEE_SPEED): number {
  if (period <= 0) return position;
  const elapsed = Math.min(Math.max(elapsedMs, 0), MAX_ELAPSED_MS);
  const next = position + (speed * elapsed) / 1000;
  return next >= period || next < 0 ? ((next % period) + period) % period : next;
}
