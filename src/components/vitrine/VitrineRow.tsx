"use client";
// Rangée à défilement horizontal de la vitrine (§1, §7, §8) : coups de cœur,
// ajoutés récemment, résultats. La piste défile au doigt, au pavé tactile, à
// la molette horizontale et au clavier (elle prend le focus, les flèches du
// clavier la font défiler) ; les flèches ‹ › avancent d'une largeur visible et
// s'estompent en bout de rangée, repéré par deux sentinelles observées.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VitrineEntry } from "@/lib/vitrine";
import { VitrineCard, type CardHighlight } from "./VitrineCard";

type Props = {
  id: string;
  title: string;
  entries: readonly VitrineEntry[];
  highlight?: CardHighlight;
  empty?: ReactNode;
};

export function VitrineRow({ id, title, entries, highlight, empty }: Props) {
  const headingId = `vitrine-row-${id}`;
  const track = useRef<HTMLDivElement>(null);
  const startMark = useRef<HTMLSpanElement>(null);
  const endMark = useRef<HTMLSpanElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const root = track.current;
    const start = startMark.current;
    const end = endMark.current;
    if (!root || !start || !end) return;
    const observer = new IntersectionObserver(
      (records) => {
        setEdges((prev) => {
          const next = { ...prev };
          for (const record of records) {
            if (record.target === start) next.start = record.isIntersecting;
            if (record.target === end) next.end = record.isIntersecting;
          }
          return next.start === prev.start && next.end === prev.end ? prev : next;
        });
      },
      { root, threshold: 0 },
    );
    observer.observe(start);
    observer.observe(end);
    return () => observer.disconnect();
  }, [entries.length]);

  function step(direction: 1 | -1) {
    const node = track.current;
    if (!node) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * node.clientWidth * 0.9, behavior: still ? "auto" : "smooth" });
  }

  return (
    <section className="vitrine-row" aria-labelledby={headingId}>
      <div className="vitrine-row-head">
        <h2 id={headingId} className="vitrine-row-title">
          {title}
        </h2>
        {entries.length ? (
          <div className="vitrine-row-arrows">
            <ArrowButton label="Ressources précédentes" faded={edges.start} onClick={() => step(-1)}>
              ‹
            </ArrowButton>
            <ArrowButton label="Ressources suivantes" faded={edges.end} onClick={() => step(1)}>
              ›
            </ArrowButton>
          </div>
        ) : null}
      </div>
      {entries.length ? (
        <div ref={track} className="vitrine-row-track" tabIndex={0} aria-labelledby={headingId}>
          <span ref={startMark} className="vitrine-row-edge" aria-hidden="true" />
          {entries.map((entry) => (
            <VitrineCard key={entry.id} entry={entry} highlight={highlight} />
          ))}
          <span ref={endMark} className="vitrine-row-edge" aria-hidden="true" />
        </div>
      ) : (
        empty ?? null
      )}
    </section>
  );
}

// aria-disabled plutôt que disabled : la flèche garde le focus clavier quand
// on atteint le bout de la rangée.
function ArrowButton({ label, faded, onClick, children }: { label: string; faded: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="vitrine-arrow"
      aria-label={label}
      aria-disabled={faded}
      data-faded={faded || undefined}
      onClick={faded ? undefined : onClick}
    >
      {children}
    </button>
  );
}
