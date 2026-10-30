"use client";
// Page ouverte : titre, corps BlockNote, état de la sauvegarde, suppression.
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UploadState } from "./Editor";
import type { SaveStatus } from "@/lib/saver";
import { useAutosave } from "./useAutosave";

const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <p className="editor-loading">Chargement de l&apos;éditeur…</p>,
});

type Props = { page: { id: string; title: string; body: unknown[] } };

export function PageView({ page }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
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
    router.push("/");
    router.refresh();
  }

  return (
    <main className="page">
      <div className="page-bar">
        <SaveIndicator status={status} />
        <UploadIndicator state={upload} onDismiss={() => setUpload(null)} />
        {trashError && <span className="status status-error">{trashError}</span>}
        <button type="button" className="ghost" onClick={moveToTrash}>
          Supprimer
        </button>
      </div>
      <textarea
        className="page-title"
        aria-label="Titre de la page"
        placeholder="Sans titre"
        rows={1}
        value={title}
        onChange={(event) => {
          // Un titre tient sur une ligne : un retour collé devient une espace.
          const next = event.target.value.replace(/\s*\n\s*/g, " ");
          setTitle(next);
          queue({ title: next });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <Editor pageId={page.id} initialBody={page.body} onChange={(body) => queue({ body })} onUploadState={setUpload} />
    </main>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status.state === "error") return <span className="status status-error" role="alert">{status.message}</span>;
  const label = status.state === "saved" ? "Enregistré" : "Enregistrement…";
  return <span className="status" aria-live="polite">{label}</span>;
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
