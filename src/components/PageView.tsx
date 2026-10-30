"use client";
// Page ouverte : titre, corps BlockNote, état de la sauvegarde, suppression.
// Une entrée de base y ajoute un lien vers sa base et ses propriétés.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UploadState } from "./Editor";
import type { Property, Values } from "@/lib/properties";
import type { SaveStatus } from "@/lib/saver";
import { label } from "@/lib/tree";
import { PropertyPanel } from "./PropertyPanel";
import { useAutosave } from "./useAutosave";

const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <p className="editor-loading">Chargement de l&apos;éditeur…</p>,
});

export type EntryContext = {
  database: { id: string; title: string; icon: string | null };
  properties: Property[];
  values: Values;
  // Bases vers lesquelles l'entrée peut être déplacée.
  databases: { id: string; title: string; icon: string | null }[];
};

type Props = { page: { id: string; title: string; body: unknown[] }; entry?: EntryContext };

export function PageView({ page, entry }: Props) {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadState>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  // Un titre enregistré change la sidebar, rendue par le serveur.
  const { status, queue, cancel } = useAutosave(page.id, (patch) => {
    if (patch.title !== undefined) router.refresh();
  });

  async function moveToTrash() {
    cancel();
    const response = await fetch(`/api/pages/${page.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setTrashError("Suppression impossible : réessayez.");
      return;
    }
    router.push(entry ? `/db/${entry.database.id}` : "/");
    router.refresh();
  }

  return (
    <main className="page">
      <div className="page-bar">
        {entry && (
          <Link href={`/db/${entry.database.id}`} className="back-link">
            ← {label({ ...entry.database, type: "database" })}
          </Link>
        )}
        <SaveIndicator status={status} />
        <UploadIndicator state={upload} onDismiss={() => setUpload(null)} />
        {trashError && <span className="status status-error">{trashError}</span>}
        <button type="button" className="ghost" onClick={moveToTrash}>
          Supprimer
        </button>
      </div>
      <TitleField initial={page.title} ariaLabel={entry ? "Titre de l'entrée" : "Titre de la page"} onChange={(title) => queue({ title })} />
      {entry && (
        <PropertyPanel
          key={entry.database.id}
          dbId={entry.database.id}
          entryId={page.id}
          properties={entry.properties}
          values={entry.values}
          databases={entry.databases}
        />
      )}
      <Editor pageId={page.id} initialBody={page.body} onChange={(body) => queue({ body })} onUploadState={setUpload} />
    </main>
  );
}

// Titre d'une page ou d'une base, enregistré par l'autosauvegarde de l'appelant.
export function TitleField({ initial, ariaLabel, onChange }: { initial: string; ariaLabel: string; onChange: (title: string) => void }) {
  const [title, setTitle] = useState(initial);
  return (
    <textarea
      className="page-title"
      aria-label={ariaLabel}
      placeholder="Sans titre"
      rows={1}
      value={title}
      onChange={(event) => {
        // Un titre tient sur une ligne : un retour collé devient une espace.
        const next = event.target.value.replace(/\s*\n\s*/g, " ");
        setTitle(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  );
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status.state === "error") return <span className="status status-error" role="alert">{status.message}</span>;
  const text = status.state === "saved" ? "Enregistré" : "Enregistrement…";
  return <span className="status" aria-live="polite">{text}</span>;
}

function UploadIndicator({ state, onDismiss }: { state: UploadState; onDismiss: () => void }) {
  if (!state) return null;
  if ("error" in state) {
    return (
      <span className="status status-error" role="alert">
        {state.error}{" "}
        <button type="button" className="link" onClick={onDismiss}>
          OK
        </button>
      </span>
    );
  }
  return (
    <span className="status">
      Envoi du fichier <progress max={100} value={state.progress} /> {state.progress} %
    </span>
  );
}
