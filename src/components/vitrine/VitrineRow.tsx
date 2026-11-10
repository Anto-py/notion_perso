// Rangée à défilement horizontal de la vitrine (§1, §7, §8) : coups de cœur,
// ajoutés récemment, résultats. Sans hook ; les flèches et l'estompage en
// bout de rangée viendront avec la vitrine interactive.
import type { VitrineEntry } from "@/lib/vitrine";
import { VitrineCard } from "./VitrineCard";

export function VitrineRow({ id, title, entries, empty }: { id: string; title: string; entries: readonly VitrineEntry[]; empty?: string }) {
  const headingId = `vitrine-row-${id}`;
  return (
    <section className="vitrine-row" aria-labelledby={headingId}>
      <h2 id={headingId} className="vitrine-row-title">
        {title}
      </h2>
      {entries.length ? (
        <div className="vitrine-row-track">
          {entries.map((entry) => (
            <VitrineCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : empty ? (
        <p className="vitrine-row-empty">{empty}</p>
      ) : null}
    </section>
  );
}
