// Mot d'accueil de la vitrine (§10) : corps de la page choisie, rendu au
// serveur par renderHtml avec les liens de la vitrine (HTML déjà échappé).
// Le repli à 4 lignes et « Lire la suite » viendront avec la vitrine
// interactive.
export function VitrineWelcome({ html }: { html: string }) {
  return <div className="vitrine-welcome public-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
