"use client";
// Bloc « conflict » : l'encadré que pose une fusion (lib/sync_merge.ts) quand
// un même bloc a changé des deux côtés. Il garde la version perdante juste
// sous la gagnante (BRAINSTORMING §11, « Conflits »). Deux gestes le
// referment : « Garder celle-ci » met son contenu à la place du bloc rival
// (props.replaces), ou à sa propre place si ce rival n'existe plus ;
// « Garder l'autre » le retire. On peut aussi y écrire, puis le supprimer.
import { createReactBlockSpec } from "@blocknote/react";
import type { EditorInstance } from "./Editor";

const conflictConfig = {
  type: "conflict",
  propSchema: {
    origin: { default: "other", values: ["mac", "web", "other"] as const },
    date: { default: "" },
    replaces: { default: "" },
  },
  content: "none",
  layoutOnly: true,
  children: { allow: "blocks" },
} as const;

type SlotRef = (node: HTMLElement | null) => void;

export const conflictBlock = createReactBlockSpec(conflictConfig, {
  renderFrame: ({ block, editor, slotRef }) => (
    <ConflictFrame
      blockId={block.id}
      origin={block.props.origin}
      date={block.props.date}
      replaces={block.props.replaces}
      editor={editor as unknown as EditorInstance}
      slotRef={slotRef}
    />
  ),
});

const ORIGIN_LABEL = { mac: "version du Mac", web: "version du web", other: "l'autre version" } as const;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-BE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Brussels",
});

function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : DATE_FORMAT.format(time);
}

function ConflictFrame({
  blockId,
  origin,
  date,
  replaces,
  editor,
  slotRef,
}: {
  blockId: string;
  origin: keyof typeof ORIGIN_LABEL;
  date: string;
  replaces: string;
  editor: EditorInstance;
  slotRef: SlotRef;
}) {
  function keepThis() {
    const box = editor.getBlock(blockId);
    if (!box) return;
    const kept = box.children.length ? box.children : [{ type: "paragraph" as const }];
    const rival = replaces ? editor.getBlock(replaces) : undefined;
    editor.transact(() => {
      if (rival && rival.id !== box.id) {
        editor.replaceBlocks([rival], kept);
        editor.removeBlocks([box.id]);
      } else editor.replaceBlocks([box], kept);
    });
  }

  function keepOther() {
    editor.removeBlocks([blockId]);
  }

  const when = formatDate(date);
  return (
    <div className="bn-conflict" role="group" aria-label="Conflit">
      <div className="bn-conflict-head" contentEditable={false}>
        <span className="bn-conflict-title">
          ⚠ Conflit : {ORIGIN_LABEL[origin]}
          {when && `, ${when}`}
        </span>
        <span className="bn-conflict-actions">
          <button type="button" className="ghost" onClick={keepThis}>
            Garder celle-ci
          </button>
          <button type="button" className="ghost" onClick={keepOther}>
            Garder l&apos;autre
          </button>
        </span>
      </div>
      <div className="bn-conflict-body" ref={slotRef} />
    </div>
  );
}
