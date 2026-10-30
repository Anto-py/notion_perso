"use client";
// Onglet Image du panneau d'icône (BRAINSTORMING §1 bis) : téléversement
// nommé, bibliothèque filtrable par nom, renommage, retrait, suppression.
import { useEffect, useState } from "react";
import { checkIconUpload, cleanIconName, ICON_TYPES, iconSrc, matchesIconName, nameFromFile } from "@/lib/icons";
import { send } from "./request";

type LibraryImage = { id: string; filename: string; name: string; uses: number };

type Pending = { file: File; preview: string; name: string };

export function ImageTab({ onPick }: { onPick: (filename: string) => void }) {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/icons")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((data: { icons: LibraryImage[] }) => alive && setImages(data.icons))
      .catch(() => alive && setError("Bibliothèque illisible : réessayez."));
    return () => {
      alive = false;
    };
  }, []);

  // L'aperçu local est libéré quand on en change ou qu'on ferme.
  useEffect(() => () => {
    if (pending) URL.revokeObjectURL(pending.preview);
  }, [pending]);

  function take(file: File | undefined) {
    if (!file) return;
    const check = checkIconUpload(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    setPending({ file, preview: URL.createObjectURL(file), name: nameFromFile(file.name) });
  }

  async function upload() {
    if (!pending) return;
    const name = cleanIconName(pending.name);
    if (!name) {
      setError("Donnez un nom à l'image.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("file", pending.file);
    form.append("name", name);
    const response = await fetch("/api/icons", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    const data = (await response?.json().catch(() => null)) as { icon?: LibraryImage; error?: string } | null;
    if (!response?.ok || !data?.icon) {
      setError(data?.error ?? "Envoi impossible : réessayez.");
      return;
    }
    onPick(data.icon.filename);
  }

  async function update(image: LibraryImage, patch: { name?: string; hidden?: boolean } | "delete") {
    const result =
      patch === "delete" ? await send(`/api/icons/${image.id}`, "DELETE") : await send(`/api/icons/${image.id}`, "PATCH", patch);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setImages((list) =>
      (list ?? []).flatMap((item) => {
        if (item.id !== image.id) return [item];
        if (patch === "delete" || patch.hidden) return [];
        return [{ ...item, ...patch }];
      }),
    );
  }

  const shown = (images ?? []).filter((image) => matchesIconName(image.name, query));

  return (
    <div className="icon-image-tab" onPaste={(event) => take(event.clipboardData.files[0])}>
      {pending ? (
        <div className="icon-pending">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.preview} alt="" className="icon-pending-preview" />
          <label className="share-field">
            <span className="control-label">Nom</span>
            <input
              autoFocus
              value={pending.name}
              maxLength={100}
              placeholder="Nom pour la retrouver"
              onChange={(event) => setPending({ ...pending, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") upload();
              }}
            />
          </label>
          <div className="icon-pending-actions">
            <button type="button" className="btn-primary" disabled={busy || !cleanIconName(pending.name)} onClick={upload}>
              {busy ? "Envoi…" : "Enregistrer"}
            </button>
            <button type="button" className="ghost" onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <label className="icon-drop">
          Choisir un fichier ou coller une image
          <span className="hint">PNG, JPEG, GIF, WebP ou AVIF, 5 Mo au plus</span>
          <input
            type="file"
            accept={Object.keys(ICON_TYPES).join(",")}
            className="icon-file-input"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>
      )}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <input
        type="search"
        className="icon-search"
        placeholder="Chercher une image par son nom"
        aria-label="Chercher une image par son nom"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {images === null && !error && <p className="hint">Chargement…</p>}
      {images !== null && !shown.length && (
        <p className="hint">{images.length ? "Aucune image de ce nom." : "Aucune image téléversée pour l'instant."}</p>
      )}
      <ul className="icon-library">
        {shown.map((image) => (
          <LibraryTile key={image.id} image={image} onPick={() => onPick(image.filename)} onUpdate={(patch) => update(image, patch)} />
        ))}
      </ul>
    </div>
  );
}

function LibraryTile({
  image,
  onPick,
  onUpdate,
}: {
  image: LibraryImage;
  onPick: () => void;
  onUpdate: (patch: { name?: string; hidden?: boolean } | "delete") => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(image.name);

  function commit() {
    setRenaming(false);
    const name = cleanIconName(draft);
    if (name && name !== image.name) onUpdate({ name });
    else setDraft(image.name);
  }

  const usedBy = image.uses === 1 ? "Utilisée par une page" : `Utilisée par ${image.uses} pages`;
  return (
    <li className="icon-tile">
      <button type="button" className="icon-tile-pick" title={image.name} onClick={onPick}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc(image.filename)} alt="" loading="lazy" />
      </button>
      {renaming ? (
        <input
          autoFocus
          className="icon-tile-name"
          value={draft}
          maxLength={100}
          aria-label="Nouveau nom"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              event.stopPropagation();
              setDraft(image.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span className="icon-tile-name">{image.name}</span>
      )}
      <span className="icon-tile-actions">
        <button type="button" className="link" onClick={() => setRenaming(true)}>
          Renommer
        </button>
        {image.uses > 0 ? (
          <button type="button" className="link" title={`${usedBy} : elle y reste`} onClick={() => onUpdate({ hidden: true })}>
            Retirer
          </button>
        ) : confirming ? (
          <button type="button" className="link icon-danger" onClick={() => onUpdate("delete")} onBlur={() => setConfirming(false)}>
            Confirmer la suppression
          </button>
        ) : (
          <button type="button" className="link" onClick={() => setConfirming(true)}>
            Supprimer
          </button>
        )}
      </span>
      {image.uses > 0 && <span className="hint icon-tile-uses">{usedBy}</span>}
    </li>
  );
}
