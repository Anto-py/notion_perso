"use client";
// Page ouverte : titre, corps BlockNote, état de la sauvegarde, suppression.
// Une entrée de base y ajoute un lien vers sa base et ses propriétés.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { EditorHandle, UploadState } from "./Editor";
import type { Property, Values } from "@/lib/properties";
import type { SaveStatus } from "@/lib/saver";
import type { TreeRow } from "@/lib/tree";
import { rebaseTyping } from "@/lib/web_save";
import { IconPicker } from "./IconPicker";
import { CoverPicker } from "./CoverPicker";
import { PageLabel } from "./PageIcon";
import { PropertyPanel } from "./PropertyPanel";
import { SharePanel } from "./SharePanel";
import { usePagePending } from "./SyncStatus";
import { useAutosave, type RemotePage } from "./useAutosave";
import { useSearchHighlight } from "./useSearchHighlight";
import { useSubpages } from "./useSubpages";

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

type Props = {
  page: {
    id: string;
    type: string;
    title: string;
    icon: string | null;
    cover: string | null;
    coverPosition: number | null;
    body: unknown[];
    publicId: string | null;
    // Révision lue, pour le contrôle de version de l'enregistrement.
    rev: number;
  };
  entry?: EntryContext;
  // Pages et bases de l'arbre : titres des blocs-liens de sous-page.
  directory: TreeRow[];
};

export function PageView({ page, entry, directory }: Props) {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadState>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  useSearchHighlight(mainRef);
  const editor = useRef<EditorHandle | null>(null);
  const onEditorReady = useCallback((handle: EditorHandle | null) => {
    editor.current = handle;
  }, []);
  // Page relue au retour sur l'onglet : titre, icône et bandeau repartent de
  // cette version (key), le corps se pose sans recréer l'éditeur.
  const [shown, setShown] = useState({ generation: 0, title: page.title, icon: page.icon, cover: page.cover, coverPosition: page.coverPosition });
  const { status, queue, cancel, savedCount } = useAutosave(page.id, {
    initial: { rev: page.rev, title: page.title, body: page.body },
    // Un titre enregistré change la sidebar, rendue par le serveur.
    onSaved: (patch) => {
      if (patch.title !== undefined) router.refresh();
    },
    // Le serveur a fusionné ce qui était parti avec une version venue
    // d'ailleurs ; les frappes tapées pendant l'aller-retour s'y reposent.
    onMerged: (sent, merged) => {
      const handle = editor.current;
      if (!handle || !sent.body || !merged.body) return;
      handle.replace(rebaseTyping(sent.body, handle.getDocument(), merged.body, new Date().toISOString()));
    },
    onRemote: (remote: RemotePage) => {
      editor.current?.replace(remote.body);
      setShown((current) => ({
        generation: current.generation + 1,
        title: remote.title,
        icon: remote.icon,
        cover: remote.cover,
        coverPosition: remote.coverPosition,
      }));
      router.refresh();
    },
  });
  // Sur le Mac : « Enregistré sur le Mac » tant que la page attend son envoi,
  // « Synchronisé » une fois arrivée sur le VPS (BRAINSTORMING §11).
  const pagePending = usePagePending(page.id, savedCount);
  const subpages = useSubpages(page.id, page.body, directory, setTrashError);

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
    <main className="page" ref={mainRef}>
      <div className="page-bar">
        {entry && (
          <Link href={`/db/${entry.database.id}`} className="back-link">
            ← <PageLabel row={{ ...entry.database, type: "database" }} />
          </Link>
        )}
        <SaveIndicator status={status} pending={pagePending} />
        <UploadIndicator state={upload} onDismiss={() => setUpload(null)} />
        {trashError && <span className="status status-error">{trashError}</span>}
        <SharePanel pageId={page.id} initialPublicId={page.publicId} />
        <button type="button" className="ghost" onClick={moveToTrash}>
          Supprimer
        </button>
      </div>
      <CoverPicker key={`cover-${shown.generation}`} pageId={page.id} initial={shown.cover} initialPosition={shown.coverPosition} />
      <IconPicker key={`icon-${shown.generation}`} pageId={page.id} type={page.type} initial={shown.icon} />
      <TitleField
        key={`title-${shown.generation}`}
        initial={shown.title}
        ariaLabel={entry ? "Titre de l'entrée" : "Titre de la page"}
        onChange={(title) => queue({ title })}
      />
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
      <Editor
        pageId={page.id}
        initialBody={page.body}
        // Une entrée n'a pas de sous-pages (seule une page en reçoit).
        onCreateChild={entry ? undefined : subpages.createChild}
        onChange={(body) => {
          queue({ body });
          if (!entry) subpages.bodyChanged(body);
        }}
        onUploadState={setUpload}
        onReady={onEditorReady}
      />
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

export function SaveIndicator({ status, pending }: { status: SaveStatus; pending?: boolean | null }) {
  if (status.state === "error") return <span className="status status-error" role="alert">{status.message}</span>;
  // pending : null sur l'app web (pas de synchronisation), true/false sur le
  // Mac une fois l'état relu. Le mot « Enregistré » seul ne dit pas en ligne.
  const text =
    status.state === "saved"
      ? pending === true
        ? "Enregistré sur le Mac"
        : pending === false
          ? "Synchronisé"
          : "Enregistré"
      : "Enregistrement…";
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
