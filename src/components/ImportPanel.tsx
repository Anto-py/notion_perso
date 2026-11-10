import { ImportForm } from "./ImportForm";

// Conseils d'export puis formulaire d'import : partagés par l'écran /import
// et Réglages › Importer.
export function ImportPanel() {
  return (
    <>
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
    </>
  );
}
