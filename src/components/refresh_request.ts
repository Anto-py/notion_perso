"use client";
// Geste « Actualiser » de la version en ligne : la page ouverte se relit par
// l'autosauvegarde (useAutosave), les parties rendues par le serveur (arbre,
// entrées de base, compteurs) par router.refresh(), appelé par l'auteur du
// geste. Le registre rend une promesse pour que l'enregistrement de ce qui
// attend soit fini avant cette relecture.
type Reload = () => Promise<void>;

const reloads = new Set<Reload>();

export function onRefreshRequested(reload: Reload): () => void {
  reloads.add(reload);
  return () => {
    reloads.delete(reload);
  };
}

// Rejette si une relecture échoue : l'appelant n'actualise alors pas le
// reste, pour ne pas poser l'état du serveur par-dessus une frappe gardée.
export async function refreshOpenContent(): Promise<void> {
  await Promise.all([...reloads].map((reload) => reload()));
}
