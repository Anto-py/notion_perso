"use client";
// Fiche superposée de la vitrine (§6) : <dialog> natif ouvert par showModal(),
// qui piège le focus et assombrit la page (::backdrop). L'en-tête se rend
// tout de suite depuis l'entrée déjà reçue ; les notes (corps de l'entrée) se
// demandent à l'ouverture et restent en mémoire par slug.
//
// La fiche ne décide de rien : ouverture, fermeture, voisines et adresse
// sont tenues par Vitrine, qui seule sait si l'ouverture a empilé une entrée
// d'historique. Échap, ✕ et clic hors de la fenêtre appellent onClose.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { slugify, type VitrineEntry } from "@/lib/vitrine";
import { ficheFromHref } from "@/lib/vitrine_state";
import { CopyUrlButton } from "../CopyUrlButton";

type Props = {
  entry: VitrineEntry | null;
  prev: VitrineEntry | null;
  next: VitrineEntry | null;
  url: string;
  onClose: () => void;
  onGo: (slug: string) => void;
  onTag: (slug: string) => void;
};

export function VitrineSheet({ entry, prev, next, url, onClose, onGo, onTag }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Notes déjà lues, par slug ; un échec n'est pas gardé (rouvrir relance).
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [failedSlug, setFailedSlug] = useState<string | null>(null);
  const slug = entry?.slug ?? null;
  const wantsNotes = Boolean(entry?.hasNotes);
  const known = slug !== null && notes.has(slug);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (slug && !node.open) node.showModal();
    if (!slug && node.open) node.close();
    // Nouvelle fiche : on la lit depuis le haut.
    if (slug) node.scrollTop = 0;
  }, [slug]);

  useEffect(() => {
    if (!slug || !wantsNotes || known) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/veille/fiche/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { html } = (await response.json()) as { html: string };
        setNotes((map) => new Map(map).set(slug, html));
      } catch {
        if (!controller.signal.aborted) setFailedSlug(slug);
      }
    })();
    return () => controller.abort();
  }, [slug, wantsNotes, known]);

  // Clic sur le fond assombri : la cible est le <dialog> lui-même, son
  // contenu remplissant toute la fenêtre.
  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.key === "ArrowLeft" ? prev : event.key === "ArrowRight" ? next : null;
    if (!target) return;
    event.preventDefault();
    onGo(target.slug);
  }

  // Lien des notes vers une autre entrée : la fiche change sur place.
  function onNotesClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a");
    const target = link ? ficheFromHref(link.getAttribute("href") ?? "", window.location.origin) : null;
    if (!target) return;
    event.preventDefault();
    onGo(target);
  }

  const html = slug ? (notes.get(slug) ?? null) : null;
  const failed = slug !== null && failedSlug === slug && html === null;

  return (
    <dialog
      ref={dialog}
      className="vitrine-sheet"
      aria-labelledby="vitrine-sheet-title"
      onCancel={(event) => {
        // Échap : la fermeture passe par Vitrine, qui défait l'historique.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Fermeture imposée par le navigateur (Échap répété) : on suit.
        if (slug) onClose();
      }}
      onClick={onDialogClick}
      onKeyDown={onKeyDown}
    >
      {entry ? (
        <div className="vitrine-sheet-inner">
          <header className="vitrine-sheet-head">
            <h2 id="vitrine-sheet-title" className="vitrine-sheet-title">
              {entry.title || "Sans titre"}
              {entry.coeur ? (
                <span className="vitrine-heart" role="img" aria-label="Coup de cœur">
                  ★
                </span>
              ) : null}
            </h2>
            <button type="button" className="vitrine-sheet-close" aria-label="Fermer la fiche" onClick={onClose}>
              ✕
            </button>
          </header>
          <Details entry={entry} onTag={onTag} />
          <div className="vitrine-sheet-actions">
            {entry.site ? (
              <a className="vitrine-sheet-site" href={entry.site} target="_blank" rel="noopener noreferrer">
                Ouvrir le site ↗
              </a>
            ) : null}
            <CopyUrlButton url={url} label="Copier le lien" />
          </div>
          {entry.description ? <p className="vitrine-sheet-desc">{entry.description}</p> : null}
          {entry.hasNotes && html !== "" ? (
            <section className="vitrine-sheet-notes" aria-labelledby="vitrine-sheet-notes-title">
              <h3 id="vitrine-sheet-notes-title">Notes d&apos;Antonin</h3>
              {html ? (
                <div className="public-body" onClick={onNotesClick} dangerouslySetInnerHTML={{ __html: html }} />
              ) : failed ? (
                <p className="vitrine-sheet-wait">Les notes n&apos;ont pas pu être chargées.</p>
              ) : (
                <p className="vitrine-sheet-wait">Chargement des notes…</p>
              )}
            </section>
          ) : null}
          <nav className="vitrine-sheet-nav" aria-label="Ressources voisines">
            <NavButton target={prev} label="précédente" onGo={onGo}>
              ‹
            </NavButton>
            <NavButton target={next} label="suivante" onGo={onGo}>
              ›
            </NavButton>
          </nav>
        </div>
      ) : null}
    </dialog>
  );
}

// Étiquettes de Domaine cliquables (fermeture puis filtre), puis niveau,
// prix et type en une ligne.
function Details({ entry, onTag }: { entry: VitrineEntry; onTag: (slug: string) => void }) {
  const meta = [entry.niveau, ...entry.prix, ...entry.type].filter(Boolean).join(" · ");
  return (
    <>
      {entry.domaines.length ? (
        <ul className="vitrine-sheet-tags" aria-label="Domaines">
          {entry.domaines.map((label) => (
            <li key={label}>
              <button type="button" className="vitrine-pill" onClick={() => onTag(slugify(label))}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {meta ? <p className="vitrine-sheet-meta">{meta}</p> : null}
    </>
  );
}

// aria-disabled plutôt que disabled : le focus reste sur la flèche en bout de
// rangée, comme dans VitrineRow.
function NavButton({
  target,
  label,
  onGo,
  children,
}: {
  target: VitrineEntry | null;
  label: string;
  onGo: (slug: string) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className="vitrine-arrow"
      aria-label={target ? `Ressource ${label} : ${target.title || "Sans titre"}` : `Aucune ressource ${label}`}
      aria-disabled={!target}
      data-faded={!target || undefined}
      onClick={target ? () => onGo(target.slug) : undefined}
    >
      {children}
    </button>
  );
}
