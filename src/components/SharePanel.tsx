"use client";
// Bouton « Partager » de l'en-tête d'une page, d'une entrée ou d'une base :
// publier sur le web, copier le lien, dépublier (BRAINSTORMING §7).
import { useEffect, useRef, useState } from "react";
import { send } from "./request";

type Props = { pageId: string; initialPublicId: string | null };

export function SharePanel({ pageId, initialPublicId }: Props) {
  const [publicId, setPublicId] = useState(initialPublicId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  // Un clic hors du panneau ou Échap le referme.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function publish() {
    setBusy(true);
    setMessage(null);
    const result = await send(`/api/share/${pageId}`, "POST");
    setBusy(false);
    if (result.ok && typeof result.data.publicId === "string") setPublicId(result.data.publicId);
    else setMessage(result.ok ? "Réponse inattendue : réessayez." : result.error);
  }

  async function unpublish() {
    setBusy(true);
    setMessage(null);
    const result = await send(`/api/share/${pageId}`, "DELETE");
    setBusy(false);
    if (result.ok) setPublicId(null);
    else setMessage(result.error);
  }

  // L'adresse complète se compose dans le navigateur : le serveur ne connaît
  // pas toujours le domaine sous lequel on le joint (proxy de Coolify). Le
  // panneau ne s'ouvre qu'après un clic, jamais au rendu serveur.
  const url = publicId && open ? `${window.location.origin}/p/${publicId}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Lien copié.");
    } catch {
      // Presse-papiers refusé (contexte non sécurisé) : le lien est
      // sélectionné, prêt pour Ctrl + C.
      linkRef.current?.select();
      setMessage("Copie impossible : le lien est sélectionné, copiez-le au clavier.");
    }
  }

  return (
    <div className="share" ref={rootRef}>
      <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        Partager{publicId ? " · publié" : ""}
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Partage public">
          <label className="share-switch">
            <input
              type="checkbox"
              role="switch"
              checked={publicId !== null}
              disabled={busy}
              onChange={(event) => (event.target.checked ? publish() : unpublish())}
            />
            Publier sur le web
          </label>
          {publicId ? (
            <>
              <p className="hint">Quiconque a le lien lit cette page et tout ce qu&apos;elle contient, sans compte.</p>
              <div className="share-link">
                <input ref={linkRef} readOnly value={url} aria-label="Lien public" onFocus={(event) => event.target.select()} />
                <button type="button" onClick={copy}>
                  Copier le lien
                </button>
              </div>
              <button type="button" className="danger" disabled={busy} onClick={unpublish}>
                Dépublier
              </button>
            </>
          ) : (
            <p className="hint">Page privée. Publier crée un lien lisible sans compte ; dépublier le coupe aussitôt.</p>
          )}
          {message && (
            <p className="status" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
