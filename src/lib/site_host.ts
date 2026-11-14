// Nom d'hôte d'un site web, validé une seule fois pour deux usages : clé de
// cache des logos de la vitrine et des favicons de mentions. Module pur et
// sans import, pour que mention.ts puisse s'en servir sans passer par
// vitrine_logo.ts, qui dépend du rendu des blocs.

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Nom d'hôte en minuscules ; null s'il n'est pas un nom de domaine à point
// (ni chemin, ni port, ni IP v6). Sert aussi de nom de fichier dans le cache :
// seuls lettres, chiffres, points et tirets y passent.
export function siteHost(raw: string): string | null {
  const host = raw.toLowerCase();
  if (host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  // Un domaine de premier niveau a au moins une lettre : « 127.0.0.1 » n'en est pas un.
  return /[a-z]/.test(labels[labels.length - 1]) ? host : null;
}
