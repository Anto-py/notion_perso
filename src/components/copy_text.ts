// Copie un texte dans le presse-papiers. Partagé par CopyUrlButton (bouton) et
// par « Copier le lien du bloc » (entrée de menu, qui n'a pas de bouton à elle).
// Rend false si aucune des deux voies n'a marché.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

// Repli quand l'API presse-papiers manque (contexte non sécurisé, navigateur
// ancien) : un champ hors écran, sélectionné, copié par la commande du navigateur.
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}
