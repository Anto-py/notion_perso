// Déplacement d'une page par la barre latérale ou par l'agent, avec ce qu'il
// change pour le public (lib/block_move_share.ts, pageMoveWarnings). Le menu
// de bloc applique la même règle dans sa propre transaction
// (lib/block_move_query.ts).
import { pageMoveWarnings } from "./block_move_share";
import { movePage, type Outcome } from "./pages";
import { forgetPublicReach, loadShareGraph } from "./publication_query";

// warnings : ce que le déplacement change pour le public, à confirmer (409).
export type PageMoveOutcome = Outcome | (Extract<Outcome, { ok: false }> & { warnings: string[] });

export const CONFIRM_REQUIRED = "Ce déplacement change ce que le public peut lire : confirmation requise.";

// Phrases de ce que le déplacement ferait au public ; vide s'il n'y change rien.
export async function pageMoveWarningsFor(id: string, parentId: string | null): Promise<string[]> {
  return pageMoveWarnings({ graph: await loadShareGraph(), pageId: id, targetId: parentId });
}

// Barre latérale. currentParentId : la mère actuelle, lue par l'appelant ;
// réordonner sous la même mère ne lit pas le graphe. Sans confirmed, un
// déplacement qui change ce que le public lit est refusé (409 et phrases)
// avant toute écriture, les refus ordinaires (boucle, base sous une page)
// passant avant : on ne demande pas d'accepter un geste impossible.
export async function movePageWithWarnings(
  id: string,
  parentId: string | null,
  currentParentId: string | null,
  beforeId: string | null | undefined,
  { placeBlock = true, confirmed = false }: { placeBlock?: boolean; confirmed?: boolean } = {},
): Promise<PageMoveOutcome> {
  const changesParent = parentId !== currentParentId;
  if (changesParent && !confirmed) {
    const warnings = await pageMoveWarningsFor(id, parentId);
    if (warnings.length) {
      const check = await movePage(id, parentId, beforeId, { dryRun: true });
      return check.ok ? { ok: false, status: 409, error: CONFIRM_REQUIRED, warnings } : check;
    }
  }
  const outcome = await movePage(id, parentId, beforeId, { placeBlock });
  // La portée publique a pu changer : un média ne se sert plus sur l'ancienne.
  if (outcome.ok && changesParent) forgetPublicReach();
  return outcome;
}
