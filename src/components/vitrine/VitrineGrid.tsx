// Grille « Toutes les ressources » de la vitrine (§1), dans l'ordre du titre
// reçu. Sans hook.
import type { VitrineEntry } from "@/lib/vitrine";
import { VitrineCard } from "./VitrineCard";

export function VitrineGrid({ entries }: { entries: readonly VitrineEntry[] }) {
  return (
    <section className="vitrine-all" aria-labelledby="vitrine-all-title">
      <h2 id="vitrine-all-title" className="vitrine-row-title">
        Toutes les ressources ({entries.length})
      </h2>
      <div className="vitrine-grid">
        {entries.map((entry) => (
          <VitrineCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}
