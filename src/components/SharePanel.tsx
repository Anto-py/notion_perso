"use client";
// Bouton « Partager » de l'en-tête d'une page, d'une entrée ou d'une base :
// publier sur le web, copier le lien, dépublier ; sous une page publiée,
// exclure la page de ce partage. Publier et exclure s'excluent. Une page
// publiée liste les liens où le visiteur lit « Contenu privé », chacun avec
// « Publier » (BRAINSTORMING §7), et les bases que ses vues liées ouvrent,
// chacune avec « Exclure » ; une base ainsi ouverte nomme la page qui
// l'ouvre (étape 16, §14).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TreeRow } from "@/lib/tree";
import { PageLabel } from "./PageIcon";
import { send } from "./request";

type Props = { pageId: string; initialPublicId: string | null; initialClosed: boolean };

type Named = { id: string; title: string } | null;
type PrivateLink = { row: TreeRow; path: string[]; excluded: boolean };
type OpenedBase = { row: TreeRow; path: string[]; host: { id: string; title: string } };
type Opener = { host: { id: string; title: string }; root: { id: string; title: string } };
type State = { isBase: boolean; closedBy: Named; sharedBy: Named; privateLinks: PrivateLink[]; openedBases: OpenedBase[]; openedBy: Opener[] };

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const quoted = (title: string) => `« ${title || "Sans titre"} »`;

function parseState(data: Record<string, unknown>): State {
  return {
    isBase: data.type === "database",
    closedBy: (data.closedBy as Named) ?? null,
    sharedBy: (data.sharedBy as Named) ?? null,
    privateLinks: list<PrivateLink>(data.privateLinks),
    openedBases: list<OpenedBase>(data.openedBases),
    openedBy: list<Opener>(data.openedBy),
  };
}

// « Lisible par la vue liée de « Veille », publiée » ; la page publiée est
// nommée à part quand la vue vit plus bas qu'elle.
function openerText(openers: Opener[]): string {
  const parts = openers.map(({ host, root }) =>
    host.id === root.id ? `${quoted(host.title)}, publiée` : `${quoted(host.title)}, dans le partage de ${quoted(root.title)}`,
  );
  return `Lisible par la vue liée de ${parts.join(" ; de ")}.`;
}

// Ce que dit le panneau d'une page non publiée : exclue ou non, lisible par
// le partage d'un ancêtre, ou par la vue liée d'une page publiée (une base).
function privateHint({ closed, isBase, sharer, openedBy }: { closed: boolean; isBase: boolean; sharer: string | null; openedBy: Opener[] }): string {
  if (closed) {
    if (sharer) return `Ni cette page ni ses sous-pages ne se lisent par le partage de ${sharer}.`;
    if (isBase) return "Exclue : aucune vue liée ne l'ouvre, le visiteur lit « Contenu privé ».";
    return "Aucune page publiée au-dessus : l'exclusion est sans effet pour l'instant.";
  }
  if (sharer) return `Lisible par le partage de ${sharer}. L'exclure la retire avec ses sous-pages.`;
  if (openedBy.length) return `${openerText(openedBy)} L'exclure la rend privée partout.`;
  return "Page privée : seul « Publier » la rend lisible. Un lien depuis une page publiée y affiche « Contenu privé ».";
}

export function SharePanel({ pageId, initialPublicId, initialClosed }: Props) {
  const router = useRouter();
  const [publicId, setPublicId] = useState(initialPublicId);
  const [closed, setClosed] = useState(initialClosed);
  const [state, setState] = useState<State | null>(null);
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

  // L'état se relit à chaque ouverture et après chaque geste : ce que les
  // liens ouvrent change avec le corps des pages, qui vit ailleurs.
  async function load() {
    const response = await fetch(`/api/share/${pageId}`, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? ((await response.json().catch(() => null)) as Record<string, unknown> | null) : null;
    if (!data) {
      setMessage("Lecture du partage impossible : réessayez.");
      return;
    }
    setPublicId(typeof data.publicId === "string" ? data.publicId : null);
    setClosed(data.closed === true);
    setState(parseState(data));
  }

  function toggle() {
    if (!open) {
      setMessage(null);
      void load();
    }
    setOpen(!open);
  }

  async function act(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const result = await send(url, method, body);
    if (!result.ok) setMessage(result.error);
    else await load();
    setBusy(false);
    return result.ok;
  }

  const publish = () => act(`/api/share/${pageId}`, "POST");
  const unpublish = () => act(`/api/share/${pageId}`, "DELETE");
  // Le cadenas de la sidebar suit : rechargement des données du serveur.
  async function setClosedOn(value: boolean) {
    if (await act(`/api/share/${pageId}`, "PATCH", { closed: value })) router.refresh();
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

  const closedBy = state?.closedBy ?? null;
  const sharedBy = state?.sharedBy ?? null;
  const privateLinks = state?.privateLinks ?? [];
  const openedBases = state?.openedBases ?? [];
  const openedBy = state?.openedBy ?? [];
  const isBase = state?.isBase ?? false;
  const sharer = `« ${sharedBy?.title || "Sans titre"} »`;

  return (
    <div className="share-bar" ref={rootRef}>
      <button type="button" className="ghost" aria-expanded={open} onClick={toggle}>
        Partager{publicId ? " · publié" : closed ? " · exclue" : ""}
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Partage public">
          {closedBy ? (
            <p className="hint">
              Rangée sous « {closedBy.title || "Sans titre"} », exclue du partage : cette page ne se publie pas.
            </p>
          ) : (
            <>
              {!closed && (
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
              )}
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
                  {privateLinks.length > 0 && (
                    <div className="share-opens">
                      <p className="share-opens-title">Le visiteur lit « Contenu privé » à la place de</p>
                      <ul>
                        {privateLinks.map((link) => (
                          <li key={link.row.id}>
                            <span className="share-opens-label">
                              <span className="share-opens-name">
                                <PageLabel row={link.row} />
                              </span>
                              {link.path.length > 0 && <span className="share-opens-path">{link.path.join(" / ")}</span>}
                            </span>
                            {link.excluded ? (
                              <span className="hint">Exclue</span>
                            ) : (
                              <button type="button" className="ghost" disabled={busy} onClick={() => act(`/api/share/${link.row.id}`, "POST")}>
                                Publier
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {openedBases.length > 0 && (
                    <div className="share-opens">
                      <p className="share-opens-title">Bases ouvertes par une vue liée</p>
                      <ul>
                        {openedBases.map((base) => (
                          <li key={base.row.id}>
                            <span className="share-opens-label">
                              <span className="share-opens-name">
                                <PageLabel row={base.row} />
                              </span>
                              <span className="share-opens-path">
                                {[...base.path, `vue liée de ${quoted(base.host.title)}`].join(" / ")}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy}
                              onClick={() => act(`/api/share/${base.row.id}`, "PATCH", { closed: true })}
                            >
                              Exclure
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(sharedBy || closed || openedBy.length > 0) && (
                    <label className="share-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={closed}
                        disabled={busy}
                        onChange={(event) => setClosedOn(event.target.checked)}
                      />
                      {sharedBy ? `Exclure du partage de ${sharer}` : "Exclure du partage"}
                    </label>
                  )}
                  <p className="hint">
                    {privateHint({ closed, isBase, sharer: sharedBy ? sharer : null, openedBy })}
                  </p>
                </>
              )}
            </>
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
