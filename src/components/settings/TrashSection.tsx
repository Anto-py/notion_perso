import { Suspense } from "react";
import { TrashPanel } from "../TrashPanel";
import { TRASH_RETENTION_DAYS } from "@/lib/pages";

// Réglages › Corbeille, sur les deux instances : la corbeille a quitté le pied
// de la barre latérale le 2026-11-10.
export function TrashSection() {
  return (
    <section id="corbeille" className="settings-section">
      <h2>Corbeille</h2>
      <p className="hint">Les éléments sont supprimés définitivement après {TRASH_RETENTION_DAYS} jours.</p>
      <Suspense fallback={<p>Chargement…</p>}>
        <TrashPanel />
      </Suspense>
    </section>
  );
}
