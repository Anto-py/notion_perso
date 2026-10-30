"use client";
// Deux blocs de mise en page, « columnList » et « column » : deux à quatre
// colonnes de blocs ordinaires. Le menu « / » pose la liste (Editor.tsx) ; le
// cadre de chaque colonne porte sa commande de retrait, celui de la liste la
// commande d'ajout. BlockNote se charge du reste : une liste réduite à une
// colonne se dissout en son contenu, une colonne vidée disparaît.
import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { COLUMNS_MAX, COLUMNS_MIN, columnHasContent } from "@/lib/blocks";
import type { EditorInstance } from "./Editor";

const columnConfig = {
  type: "column",
  propSchema: {},
  content: "none",
  layoutOnly: true,
  // Une colonne ne vit que dans une liste de colonnes, et ne se glisse pas :
  // c'est la liste qui se déplace.
  placeable: "namedOnly",
  children: { allow: "blocks" },
} as const;

const columnListConfig = {
  type: "columnList",
  propSchema: {},
  content: "none",
  layoutOnly: true,
  children: { allow: ["column"], min: COLUMNS_MIN },
} as const;

type SlotRef = (node: HTMLElement | null) => void;

export const columnBlock = createReactBlockSpec(columnConfig, {
  renderFrame: ({ block, editor, slotRef }) => (
    <ColumnFrame blockId={block.id} editor={editor as unknown as EditorInstance} slotRef={slotRef} />
  ),
});

export const columnListBlock = createReactBlockSpec(columnListConfig, {
  renderFrame: ({ block, editor, slotRef }) => (
    <ColumnListFrame
      blockId={block.id}
      count={block.children.length}
      editor={editor as unknown as EditorInstance}
      slotRef={slotRef}
    />
  ),
});

function ColumnFrame({ blockId, editor, slotRef }: { blockId: string; editor: EditorInstance; slotRef: SlotRef }) {
  const [asking, setAsking] = useState(false);
  // Les colonnes sont enveloppées chacune dans un div « display: contents » :
  // aucun sélecteur de fratrie ne les atteint, d'où cette classe pour le filet
  // qui les sépare une fois empilées.
  const first = editor.getParentBlock(blockId)?.children[0]?.id === blockId;

  // Une colonne qui porte quelque chose se retire en deux clics : le contenu
  // part avec elle, sans boîte de dialogue du navigateur.
  function remove() {
    const column = editor.getBlock(blockId);
    if (!column) return;
    if (!asking && columnHasContent(column)) {
      setAsking(true);
      return;
    }
    // Pas de removeBlocks : la réparation de BlockNote retirerait aussi les
    // colonnes restées vides, et la rangée entière disparaîtrait. On remplace
    // la liste par elle-même sans la colonne, ou par le contenu de la
    // survivante quand il n'en reste qu'une (une colonne seule se dissout).
    const list = editor.getParentBlock(column);
    if (!list || list.type !== "columnList") return;
    const remaining = list.children.filter((child) => child.id !== column.id);
    const blocks =
      remaining.length >= COLUMNS_MIN
        ? [{ ...list, children: remaining }]
        : remaining.flatMap((child) => child.children);
    editor.replaceBlocks([list.id], blocks);
  }

  return (
    <div className={first ? "bn-column bn-column-first" : "bn-column"}>
      <div className="bn-column-body" ref={slotRef} />
      <div className="bn-column-tools" contentEditable={false}>
        {asking ? (
          <span className="bn-column-confirm" role="alert">
            <button type="button" className="danger" onClick={remove}>
              Supprimer
            </button>
            <button type="button" className="ghost" onClick={() => setAsking(false)}>
              Annuler
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="bn-column-remove"
            title="Retirer cette colonne"
            aria-label="Retirer cette colonne"
            onClick={remove}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function ColumnListFrame({
  blockId,
  count,
  editor,
  slotRef,
}: {
  blockId: string;
  count: number;
  editor: EditorInstance;
  slotRef: SlotRef;
}) {
  // La colonne naît à la fin de la rangée, curseur dans son paragraphe.
  function add() {
    const list = editor.getBlock(blockId);
    const last = list?.children.at(-1);
    if (!last) return;
    const inserted = editor.insertBlocks([{ type: "column", children: [{ type: "paragraph" }] }], last, "after");
    const first = inserted[0]?.children[0];
    if (first) editor.setTextCursorPosition(first.id, "end");
  }

  return (
    <div className="bn-columns">
      <div className="bn-columns-row" ref={slotRef} />
      <div className="bn-columns-tools" contentEditable={false}>
        {count < COLUMNS_MAX && (
          <button
            type="button"
            className="bn-columns-add"
            title="Ajouter une colonne"
            aria-label="Ajouter une colonne"
            onClick={add}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
