import { ImportPanel } from "@/components/ImportPanel";

// Écran d'import d'un export Notion, gardé pour les onglets et les adresses
// directes ; le menu vit désormais dans Réglages › Importer. La lecture du zip
// et l'écriture des pages vivent dans /api/import.
export default function ImportPage() {
  return (
    <main className="page import-page">
      <h1>Importer depuis Notion</h1>
      <ImportPanel />
    </main>
  );
}
