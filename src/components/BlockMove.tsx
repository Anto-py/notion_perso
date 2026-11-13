"use client";
// « Déplacer vers… » du menu de bloc (étape 21, palier c). Le menu de la poignée
// se ferme au clic : le sélecteur de page ne peut pas y vivre. Ce fournisseur,
// monté dans l'éditeur, le tient hors du menu ; l'entrée du menu ne fait que le
// demander (useAskBlockMove).
//
// Ordre des gestes, qui garantit « un doublon plutôt qu'une perte » : la
// requête ajoute le bloc à la cible et fait changer de mère les sous-pages
// emportées sans toucher à la source ; l'annuaire apprend ces nouvelles mères
// ensuite (sans cela, le bloc disparu ferait jeter la sous-page par
// useSubpages) ; le bloc ne quitte l'éditeur qu'à ce moment, et l'enregistrement
// automatique persiste la source.
import { useBlockNoteEditor } from "@blocknote/react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { blockMoveError, carriedSubpages, type MoveRow } from "@/lib/block_move";
import type { TreeRow } from "@/lib/tree";
import { BlockMoveConfirm } from "./BlockMoveConfirm";
import { PagePicker } from "./PagePicker";
import { announcePageMoved } from "./page_moved";
import { send } from "./request";
import { addToDirectory, useDirectory } from "./subpageBlock";

type Ask = (blockId: string) => void;

const AskContext = createContext<Ask | null>(null);

// Null hors d'un éditeur de page : l'entrée du menu se masque alors.
export function useAskBlockMove(): Ask | null {
  return useContext(AskContext);
}

function moveRows(pages: ReadonlyMap<string, TreeRow>): Map<string, MoveRow> {
  return new Map([...pages].map(([id, row]) => [id, { parentId: row.parentId, type: row.type, isBasesRoot: row.basesRoot }]));
}

type Moved = { destination: string | null; created: boolean; title: string; moved: string[] };

export function BlockMoveProvider({ pageId, onError, children }: { pageId: string; onError: (message: string) => void; children: ReactNode }) {
  const editor = useBlockNoteEditor();
  const router = useRouter();
  const { pages } = useDirectory();
  const [asked, setAsked] = useState<{ blockId: string; anchor: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  // Le serveur a refusé d'écrire sans accord : ce que le déplacement change pour le public.
  const [pending, setPending] = useState<{ row: TreeRow | null; warnings: string[] } | null>(null);

  const ask = useCallback<Ask>(
    (blockId) => {
      // Le sélecteur se pose sous le bloc visé, ou sous l'éditeur à défaut.
      const root = editor.domElement;
      const anchor = root?.querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`) ?? root;
      if (anchor) setAsked({ blockId, anchor });
    },
    [editor],
  );
  const cancel = useCallback(() => {
    setAsked(null);
    setPending(null);
  }, []);
  // Une requête en route ne s'abandonne pas : le geste irait à son terme sans qu'on le voie.
  const cancelConfirm = useCallback(() => {
    if (!busy) cancel();
  }, [busy, cancel]);

  async function move(row: TreeRow | null, confirmed = false) {
    if (!asked || busy) return;
    const { blockId } = asked;
    const block = editor.getBlock(blockId);
    if (!block) {
      cancel();
      return;
    }
    const blocks = [block];
    const targetId = row?.id ?? null;
    const rows = moveRows(pages);
    onError("");
    // Même règle que le serveur (lib/block_move.ts), pour refuser sans attendre.
    const refused = blockMoveError({ sourceId: pageId, targetId, carried: carriedSubpages(blocks, pageId, rows), rows });
    if (refused) {
      cancel();
      onError(refused);
      return;
    }
    setBusy(true);
    const result = await send(`/api/pages/${pageId}/move-block`, "POST", { blocks, targetId, confirmed });
    setBusy(false);
    // Le serveur n'a rien écrit : on montre ce qui changerait pour le public et on attend l'accord.
    const warnings = !result.ok ? result.data?.warnings : undefined;
    if (Array.isArray(warnings) && warnings.length > 0) {
      setPending({ row, warnings: warnings.map(String) });
      return;
    }
    cancel();
    if (!result.ok) {
      onError(result.error);
      return;
    }
    const { destination, created, title, moved } = result.data as unknown as Moved;
    if (created && destination) addToDirectory({ id: destination, parentId: null, type: "page", title, icon: null, closed: false });
    for (const id of moved) announcePageMoved({ pageId: id, from: pageId, to: destination });
    const still = editor.getBlock(blockId);
    if (still) editor.removeBlocks([still]);
    router.refresh();
  }

  return (
    <AskContext.Provider value={ask}>
      {children}
      {asked && pending && (
        <BlockMoveConfirm
          anchor={asked.anchor}
          warnings={pending.warnings}
          busy={busy}
          onConfirm={() => void move(pending.row, true)}
          onCancel={cancelConfirm}
        />
      )}
      {asked && !pending && (
        <PagePicker
          anchor={asked.anchor}
          pages={pages}
          hostId={pageId}
          label="Chercher la page où déplacer le bloc"
          // Une base ne reçoit pas de blocs : on ne la propose pas.
          accept={(row) => row.type === "page"}
          rootLabel="Racine"
          onPickRoot={() => void move(null)}
          onPick={(row) => void move(row)}
          onCancel={cancel}
          busy={busy ? "Déplacement…" : undefined}
        />
      )}
    </AskContext.Provider>
  );
}
