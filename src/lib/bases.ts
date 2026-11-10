// Racine des bases (étapes 16 et 17, SPECS « Racine dans « Bases de données » ») :
// la racine est la ligne `is_bases_root`, une page sous « Ressources ». Bases et
// dossiers vivent sous elle ou sous un dossier ; les pages vivent sous une page
// ou sous la racine. Module pur, importé par le serveur (création, déplacement,
// restauration, synchronisation) comme par le navigateur (refus immédiat d'un
// dépôt dans la barre latérale).

// Ancien id du dossier racine, gardé pour les fixtures de test seulement : le
// code lit la racine par son rôle (`basesRootId`, lib/pages.ts).
export const BASES_ROOT_ID = "pg_basesracine00000";
export const BASES_TITLE = "Bases de données";
export const BASES_ICON = "📚";
export const FOLDER_ICON = "📁";

export type PageKind = "page" | "database" | "entry" | "folder";

export type Placeable = { type: PageKind; isBasesRoot?: boolean };

// Une base ou un dossier : ce qui habite la racine.
export function livesInBases(type: PageKind): boolean {
  return type === "database" || type === "folder";
}

// La racine ou l'un de ses dossiers : ce qui reçoit bases et dossiers.
function isBasesSide(parent: Placeable): boolean {
  return parent.isBasesRoot === true || parent.type === "folder";
}

// Pourquoi child ne peut pas aller sous parent (null : à la racine de
// l'arbre), ou null si le rangement est permis. Une seule règle pour la
// création, le déplacement, la restauration et la synchronisation.
export function placementError(child: Placeable, parent: Placeable | null): string | null {
  if (child.type === "entry") return "Une entrée vit dans sa base.";
  if (livesInBases(child.type)) {
    if (parent && isBasesSide(parent)) return null;
    return child.type === "database"
      ? "Une base ne vit que dans « Bases de données »."
      : "Un dossier ne vit que dans « Bases de données ».";
  }
  if (!parent || parent.type === "page") return null;
  return "Seule une page peut recevoir des sous-pages.";
}

// Parent de repli quand le parent d'origine manque ou refuse l'élément
// (restauration, réception d'une synchronisation) : la racine des bases pour
// une base ou un dossier, la racine de l'arbre pour une page. L'id de la
// racine est lu en base (`basesRootId`, lib/pages.ts), jamais fixé ici.
export function fallbackParent(type: PageKind, rootId: string | null): string | null {
  return livesInBases(type) ? rootId : null;
}

// Gestes interdits sur des pages à rôle fixe. La racine des bases et le
// Vide-cerveau ne partent pas en corbeille : la racine porte le rangement de
// toutes les bases, l'épingle et la capture supposent le Vide-cerveau vivant.
export function trashError(row: { isBasesRoot: boolean; isInbox: boolean }): string | null {
  if (row.isBasesRoot) return "« Bases de données » ne va pas à la corbeille.";
  if (row.isInbox) return "Le Vide-cerveau ne va pas à la corbeille.";
  return null;
}

export function publishError(row: Placeable): string | null {
  if (row.isBasesRoot) return "La page « Bases de données » ne se publie pas.";
  if (row.type === "folder") return "Un dossier ne se publie pas : publiez une base ou une page.";
  return null;
}
