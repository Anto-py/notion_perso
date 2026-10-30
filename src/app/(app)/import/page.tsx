import { ImportForm } from "@/components/ImportForm";

// Écran d'import d'un export Notion. La lecture du zip et l'écriture des pages
// vivent dans /api/import ; cette page ne fait que porter le formulaire.
export default function ImportPage() {
  return (
    <main className="page import-page">
      <h1>Importer depuis Notion</h1>
      <p className="import-intro">
        Dans Notion, ouvrez le menu <strong>…</strong> de la page à exporter, choisissez{" "}
        <strong>Exporter</strong>, puis <strong>Markdown &amp; CSV</strong>. Déposez ici l&apos;archive zip
        téléchargée. L&apos;export complet de l&apos;espace de travail convient aussi : ses pages racine
        seront regroupées sous une page « Import Notion ».
      </p>
      <p className="import-intro import-hint">
        Un second import du même fichier crée une seconde copie : l&apos;ancienne se jette par la corbeille.
        Les formules, relations et fichiers non pris en charge sont signalés dans le rapport de fin.
      </p>
      <ImportForm />
    </main>
  );
}
