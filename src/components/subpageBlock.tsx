"use client";
// Bloc « subpage » : lien vers une sous-page ou une base née du menu « / », ou
// lien vers une page rangée n'importe où (« Lien vers une page », link: true).
// Le bloc ne garde que l'id ; titre et icône viennent de l'annuaire des pages
// (arbre de la sidebar), tenu à jour par PageView à chaque rendu serveur. Un
// titre changé dans la sous-page se voit donc ici sans réécrire le corps.
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { isForeignLink } from "@/lib/blocks";
import type { AbsentTarget, TreeRow } from "@/lib/tree";
import type { EditorInstance } from "./Editor";
import { PageLabel } from "./PageIcon";
import { PagePicker } from "./PagePicker";

// Annuaire hors de React : le bloc est rendu par BlockNote, loin de PageView.
// Il porte aussi la page hôte (marque ↗) et ce que le serveur sait des cibles
// absentes de l'arbre (corbeille ou suppression).
type Directory = {
  pages: ReadonlyMap<string, TreeRow>;
  hostId: string;
  absent: Readonly<Record<string, AbsentTarget>>;
};
type HostContext = Omit<Directory, "pages">;

let state: Directory = { pages: new Map(), hostId: "", absent: {} };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setPageDirectory(rows: readonly TreeRow[], host?: HostContext): void {
  state = { ...state, ...host, pages: new Map(rows.map((row) => [row.id, row])) };
  notify();
}

// Une page tout juste créée, avant que le serveur ne renvoie l'arbre.
export function addToDirectory(row: TreeRow): void {
  setPageDirectory([...state.pages.values(), row]);
}

export function getPageDirectory(): ReadonlyMap<string, TreeRow> {
  return state.pages;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// L'annuaire tel qu'un bloc le lit : blocs-liens de sous-page et sélecteur de
// base d'une vue liée.
export function usePageDirectory(): ReadonlyMap<string, TreeRow> {
  return useSyncExternalStore(subscribe, () => state.pages, () => state.pages);
}

export function useDirectory(): Directory {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// Liens que le menu « / » vient de poser : leur sélecteur s'ouvre de lui-même.
// BlockNote monte le bloc pendant l'insertion, avant que l'appelant ne
// connaisse son id : la marque arrive après et se lit comme un abonnement.
// Un lien resté vide (page rechargée pendant le choix) attend un clic.
const freshLinks = new Set<string>();

export function markFreshLink(blockId: string): void {
  freshLinks.add(blockId);
  notify();
}

function forgetFreshLink(blockId: string): void {
  if (freshLinks.delete(blockId)) notify();
}

export const subpageBlock = createReactBlockSpec(
  {
    type: "subpage",
    propSchema: {
      pageId: { default: "" },
      kind: { default: "page", values: ["page", "database"] as const },
      // Vrai : posé par « Lien vers une page », sans pouvoir sur sa cible.
      link: { default: false },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const { pageId, kind, link } = block.props;
      if (link && !pageId) {
        const instance = editor as unknown as EditorInstance;
        return (
          <LinkChoice
            blockId={block.id}
            onPick={(row) => {
              forgetFreshLink(block.id);
              instance.updateBlock(block.id, { props: { pageId: row.id, kind: row.type === "database" ? "database" : "page" } });
              instance.focus();
            }}
            onCancel={() => {
              forgetFreshLink(block.id);
              // Une ligne vide plutôt qu'un retrait : la ligne où l'on a tapé
              // « / » revient, et une colonne n'est jamais vidée (un
              // removeBlocks y emporterait toute la rangée).
              const current = instance.getBlock(block.id);
              if (!current) return;
              const { insertedBlocks } = instance.replaceBlocks([current], [{ type: "paragraph" }]);
              if (insertedBlocks[0]) instance.setTextCursorPosition(insertedBlocks[0], "start");
              instance.focus();
            }}
          />
        );
      }
      return <SubpageLink pageId={pageId} kind={kind} link={link} />;
    },
  },
);

function LinkChoice({ blockId, onPick, onCancel }: { blockId: string; onPick: (row: TreeRow) => void; onCancel: () => void }) {
  const { pages, hostId } = useDirectory();
  const fresh = useSyncExternalStore(subscribe, () => freshLinks.has(blockId), () => false);
  const [clicked, setClicked] = useState(false);
  const open = fresh || clicked;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="subpage-block" contentEditable={false}>
      <button ref={setAnchor} type="button" className="subpage-choose" onClick={() => setClicked(true)}>
        ↗ Lien vers une page : choisir la cible…
      </button>
      {open && anchor && <PagePicker anchor={anchor} pages={pages} hostId={hostId} onPick={onPick} onCancel={onCancel} />}
    </div>
  );
}

function SubpageLink({ pageId, kind, link }: { pageId: string; kind: "page" | "database"; link: boolean }) {
  const { pages, hostId, absent } = useDirectory();
  const icon = kind === "database" ? "🗃️" : "📄";
  if (!pageId) {
    return (
      <div className="subpage-block subpage-pending" contentEditable={false}>
        Création de la {kind === "database" ? "base" : "page"}…
      </div>
    );
  }
  const row = pages.get(pageId);
  if (!row) {
    // Ni lien ni clic : la cible restaurée le rend au prochain rendu serveur.
    const label = absent[pageId] === "trashed" ? "En corbeille" : absent[pageId] === "deleted" ? "Page supprimée" : "Introuvable : en corbeille ou supprimée";
    return (
      <div className="subpage-block subpage-missing" contentEditable={false}>
        {icon} {label}
      </div>
    );
  }
  const foreign = isForeignLink(link, row.parentId, hostId);
  return (
    <div className="subpage-block" contentEditable={false}>
      <Link href={row.type === "database" ? `/db/${row.id}` : `/page/${row.id}`}>
        <PageLabel row={row} />
        {foreign && (
          <span className="subpage-arrow" title="Lien vers une page rangée ailleurs" aria-label="lien">
            ↗
          </span>
        )}
      </Link>
    </div>
  );
}
