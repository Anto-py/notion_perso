// Déplacement d'un bloc vers une autre page ou vers la racine (étape 21,
// palier c). Le navigateur envoie le bloc tel que l'éditeur le montre (sa
// source peut porter des frappes pas encore enregistrées) ; tout se joue en une
// transaction : le bloc est ajouté à la cible, puis les sous-pages qu'il emporte
// changent de mère. Le serveur n'écrit jamais le corps de la source : l'éditeur
// ouvert retire le bloc après la réponse et son enregistrement automatique le
// persiste (un seul écrivain, pas de conflit). Un échec en route, ou une coupure
// avant ce retrait, laisse donc un doublon et jamais une perte.
import { db } from "@/db";
import { pages } from "@/db/schema";
import { blockMoveError, blockTitle, carriedSubpages, soleSubpage, type MoveRow } from "./block_move";
import { sharingWarnings } from "./block_move_share";
import { appendBlocks, createPage, movePage, type Outcome } from "./pages";
import { forgetPublicReach, loadShareGraph } from "./publication_query";

// warnings : ce que le déplacement change pour le public, à confirmer (409).
type Failure = Extract<Outcome, { ok: false }> & { warnings?: string[] };

// destination : la mère des sous-pages emportées, soit la page cible, la page
// née du bloc, ou null quand une sous-page remonte seule à la racine.
export type BlockMoved = {
  ok: true;
  destination: string | null;
  created: boolean;
  title: string;
  moved: string[];
};

// Lever plutôt que rendre : un retour d'échec dans le callback validerait les
// écritures déjà faites, une exception les annule.
class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}

function must(outcome: Outcome): void {
  if (!outcome.ok) throw new Refused(outcome);
}

// confirmed : l'appelant a vu les avertissements de partage et les accepte. Sans
// lui, un déplacement qui change ce que le public lit est refusé avant toute
// écriture, avec la liste des phrases à montrer.
export async function moveBlock(
  sourceId: string,
  targetId: string | null,
  blocks: unknown[],
  { confirmed = false }: { confirmed?: boolean } = {},
): Promise<BlockMoved | Failure> {
  // Lu avant la transaction : ni verrou ni connexion tenue pour un calcul pur.
  const graph = await loadShareGraph();
  try {
    const moved = await db.transaction(async (tx) => {
      const list = await tx
        .select({ id: pages.id, parentId: pages.parentId, type: pages.type, trashedAt: pages.trashedAt, isBasesRoot: pages.isBasesRoot })
        .from(pages);
      const rows = new Map<string, MoveRow>(
        list.map((row) => [row.id, { parentId: row.parentId, type: row.type, trashed: row.trashedAt !== null, isBasesRoot: row.isBasesRoot }]),
      );
      const carried = carriedSubpages(blocks, sourceId, rows);
      const refused = blockMoveError({ sourceId, targetId, carried, rows });
      if (refused) throw new Refused({ ok: false, status: 400, error: refused });
      if (!confirmed) {
        const warnings = sharingWarnings({ graph, sourceId, targetId, carried, blocks });
        if (warnings.length) {
          throw new Refused({ ok: false, status: 409, error: "Ce déplacement change ce que le public peut lire : confirmation requise.", warnings });
        }
      }

      // Un bloc qui n'est qu'une sous-page, envoyé à la racine : la page remonte
      // telle quelle, sans page neuve.
      const sole = targetId === null ? soleSubpage(blocks, carried) : null;
      if (sole) {
        must(await movePage(sole, null, undefined, { placeBlock: false, leaveBlock: true, tx }));
        return { ok: true as const, destination: null, created: false, title: "", moved: [sole] };
      }

      let destination: string;
      let title = "";
      if (targetId === null) {
        title = blockTitle(blocks);
        const made = await createPage(null, "page", { title, body: blocks }, tx);
        must(made);
        destination = made.id as string;
      } else {
        must(await appendBlocks(targetId, blocks, tx));
        destination = targetId;
      }
      for (const id of carried) {
        must(await movePage(id, destination, undefined, { placeBlock: false, leaveBlock: true, tx }));
      }
      return { ok: true as const, destination, created: targetId === null, title, moved: carried };
    });
    // La portée publique a pu changer : un média ne se sert plus sur l'ancienne.
    forgetPublicReach();
    return moved;
  } catch (error) {
    if (error instanceof Refused) return error.failure;
    throw error;
  }
}
