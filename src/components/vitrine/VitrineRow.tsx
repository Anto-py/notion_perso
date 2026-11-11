"use client";
// Rangée à défilement horizontal de la vitrine (§1, §7, §8) : coups de cœur,
// ajoutés récemment, résultats. La piste défile au doigt, au pavé tactile, à
// la molette horizontale et au clavier (elle prend le focus, les flèches du
// clavier la font défiler) ; les flèches ‹ › avancent d'une largeur visible et
// s'estompent en bout de rangée, repéré par deux sentinelles observées.
//
// Avec autoScroll (coups de cœur vers la gauche, ajoutés récemment vers la
// droite), la rangée défile seule, lentement et en boucle, dès que ses cartes débordent : un second jeu de
// cartes (copies) suit le premier, et la piste recule d'une période au bout
// (marqueeStep). Elle s'arrête au survol de la piste, quand le focus y est,
// quelques secondes après un geste du visiteur, et tant que son bouton ⏸ la
// tient en pause (WCAG 2.2.2) ; elle ne bouge jamais si le système demande
// moins de mouvement.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VitrineEntry } from "@/lib/vitrine";
import { MARQUEE_HOLD_MS, MARQUEE_SPEED, marqueeStep } from "@/lib/vitrine_marquee";
import type { SheetRow } from "@/lib/vitrine_state";
import { VitrineCard, type CardHighlight } from "./VitrineCard";

type Props = {
  id: Exclude<SheetRow, "all">;
  title: string;
  entries: readonly VitrineEntry[];
  highlight?: CardHighlight;
  empty?: ReactNode;
  // Sens où glissent les cartes.
  autoScroll?: "gauche" | "droite";
};

// Largeur d'un jeu de cartes : écart entre la première carte et sa copie.
function periodOf(node: HTMLElement): number {
  const first = node.querySelector<HTMLElement>(".vitrine-card");
  const copy = node.querySelector<HTMLElement>("[data-clone]");
  return first && copy ? copy.getBoundingClientRect().left - first.getBoundingClientRect().left : 0;
}

export function VitrineRow({ id, title, entries, highlight, empty, autoScroll }: Props) {
  const headingId = `vitrine-row-${id}`;
  const track = useRef<HTMLDivElement>(null);
  const holdUntil = useRef(0);
  const [loop, setLoop] = useState(false);
  const [stopped, setStopped] = useState(false);
  const marquee = Boolean(autoScroll) && entries.length > 1;
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

  // La boucle ne naît qu'après l'hydratation : le serveur rend la rangée
  // sans copies. Elle tient tant que le premier jeu déborde de la piste.
  useEffect(() => {
    const node = track.current;
    if (!marquee || !node) {
      setLoop(false);
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const measure = () => {
      const period = periodOf(node);
      const overflow = period ? period > node.clientWidth : node.scrollWidth > node.clientWidth + 1;
      setLoop(overflow && !still.matches);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    still.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      still.removeEventListener("change", measure);
    };
  }, [marquee, entries.length]);

  useEffect(() => {
    const node = track.current;
    if (!loop || stopped || !node) return;
    const speed = autoScroll === "droite" ? -MARQUEE_SPEED : MARQUEE_SPEED;
    let period = periodOf(node);
    let position = node.scrollLeft;
    let last = 0;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      period = periodOf(node);
    });
    observer.observe(node);
    const hold = () => {
      holdUntil.current = performance.now() + MARQUEE_HOLD_MS;
    };
    const gestures = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of gestures) node.addEventListener(name, hold, { passive: true });
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = last ? now - last : 0;
      last = now;
      const paused = now < holdUntil.current || node.matches(":hover") || node.contains(document.activeElement);
      if (paused) return;
      // Le visiteur a fait défiler la piste : on repart de là où il l'a laissée.
      if (Math.abs(node.scrollLeft - position) > 2) position = node.scrollLeft;
      position = marqueeStep(position, elapsed, period, speed);
      node.scrollLeft = position;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const name of gestures) node.removeEventListener(name, hold);
    };
  }, [loop, stopped, autoScroll]);

  function step(direction: 1 | -1) {
    const node = track.current;
    if (!node) return;
    holdUntil.current = performance.now() + MARQUEE_HOLD_MS;
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
            {loop ? (
              <button
                type="button"
                className="vitrine-arrow vitrine-pause"
                aria-label={stopped ? "Reprendre le défilement" : "Mettre le défilement en pause"}
                onClick={() => setStopped((value) => !value)}
              >
                {stopped ? "▶\uFE0E" : "⏸\uFE0E"}
              </button>
            ) : null}
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
        <div
          ref={track}
          className="vitrine-row-track"
          tabIndex={0}
          aria-labelledby={headingId}
          data-marquee={loop || undefined}
        >
          <span ref={startMark} className="vitrine-row-edge" aria-hidden="true" />
          {entries.map((entry) => (
            <VitrineCard key={entry.id} entry={entry} row={id} highlight={highlight} />
          ))}
          {loop
            ? entries.map((entry) => (
                <VitrineCard key={`copie-${entry.id}`} entry={entry} row={id} highlight={highlight} clone />
              ))
            : null}
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
