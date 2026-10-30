"use client";
// Bloc « subpage » : lien vers une sous-page ou une base née du menu « / ».
// Le bloc ne garde que l'id ; titre et icône viennent de l'annuaire des pages
// (arbre de la sidebar), tenu à jour par PageView à chaque rendu serveur. Un
// titre changé dans la sous-page se voit donc ici sans réécrire le corps.
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { label, type TreeRow } from "@/lib/tree";

// Annuaire hors de React : le bloc est rendu par BlockNote, loin de PageView.
let directory: ReadonlyMap<string, TreeRow> = new Map();
const listeners = new Set<() => void>();

export function setPageDirectory(rows: readonly TreeRow[]): void {
  directory = new Map(rows.map((row) => [row.id, row]));
  for (const listener of listeners) listener();
}

// Une page tout juste créée, avant que le serveur ne renvoie l'arbre.
export function addToDirectory(row: TreeRow): void {
  setPageDirectory([...directory.values(), row]);
}

export function getPageDirectory(): ReadonlyMap<string, TreeRow> {
  return directory;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const subpageBlock = createReactBlockSpec(
  {
    type: "subpage",
    propSchema: {
      pageId: { default: "" },
      kind: { default: "page", values: ["page", "database"] as const },
    },
    content: "none",
  },
  {
    render: ({ block }) => <SubpageLink pageId={block.props.pageId} kind={block.props.kind} />,
  },
);

function SubpageLink({ pageId, kind }: { pageId: string; kind: "page" | "database" }) {
  const pages = useSyncExternalStore(subscribe, () => directory, () => directory);
  if (!pageId) {
    return (
      <div className="subpage-block subpage-pending" contentEditable={false}>
        Création de la {kind === "database" ? "base" : "page"}…
      </div>
    );
  }
  const row = pages.get(pageId);
  if (!row) {
    return (
      <div className="subpage-block subpage-missing" contentEditable={false}>
        {kind === "database" ? "🗃️" : "📄"} Introuvable : en corbeille ou supprimée
      </div>
    );
  }
  return (
    <div className="subpage-block" contentEditable={false}>
      <Link href={row.type === "database" ? `/db/${row.id}` : `/page/${row.id}`}>{label(row)}</Link>
    </div>
  );
}
