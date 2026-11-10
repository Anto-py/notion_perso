import { ImportPanel } from "../ImportPanel";

// Réglages › Importer, sur les deux instances : l'import Notion a quitté le
// pied de la barre latérale le 2026-11-10.
export function ImportSection() {
  return (
    <section id="importer" className="settings-section">
      <h2>Importer</h2>
      <ImportPanel />
    </section>
  );
}
