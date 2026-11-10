import { Suspense } from "react";
import { TrashPanel } from "@/components/TrashPanel";
import { TRASH_RETENTION_DAYS } from "@/lib/pages";

// Écran de la corbeille, gardé pour les onglets et les adresses directes ; le
// menu vit désormais dans Réglages › Corbeille.
export default function TrashPage() {
  return (
    <main className="page">
      <h1>Corbeille</h1>
      <p className="hint">Les éléments sont supprimés définitivement après {TRASH_RETENTION_DAYS} jours.</p>
      <Suspense fallback={<p>Chargement…</p>}>
        <TrashPanel />
      </Suspense>
    </main>
  );
}
