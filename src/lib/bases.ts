// Dossier « Bases » (étape 16, SPECS « Dossier « Bases » ») : toute base et
// tout dossier vivent sous la racine, rien d'autre n'y entre. Module pur,
// importé par le serveur (création, déplacement, restauration, synchronisation)
// comme par le navigateur (refus immédiat d'un dépôt dans la barre latérale).

// Posée par la migration 0012 avec cet id sur chaque instance.
export const BASES_ROOT_ID = "pg_basesracine00000";
export const BASES_TITLE = "Bases";
export const BASES_ICON = "🗂️";
export const FOLDER_ICON = "📁";

export type PageKind = "page" | "database" | "entry" | "folder";

export type Placeable = { type: PageKind; isBasesRoot?: boolean };

// Une base ou un dossier : ce qui habite « Bases ».
export function livesInBases(type: PageKind): boolean {
  return type === "database" || type === "folder";
}

// La racine ou l'un de ses dossiers : ce qui reçoit bases et dossiers.
function isBasesSide(parent: Placeable): boolean {
  return parent.type === "folder";
}

// Pourquoi child ne peut pas aller sous parent (null : à la racine de
// l'arbre), ou null si le rangement est permis. Une seule règle pour la
// création, le déplacement, la restauration et la synchronisation.
export function placementError(child: Placeable, parent: Placeable | null): string | null {
  // « Bases » se déplace parmi les racines (l'ordre est une clé comme pour une
  // page), mais ne se range jamais sous un autre élément.
  if (child.isBasesRoot) return parent ? "« Bases » reste à la racine de l'arbre." : null;
  if (child.type === "entry") return "Une entrée vit dans sa base.";
  if (livesInBases(child.type)) {
    if (parent && isBasesSide(parent)) return null;
    return child.type === "database" ? "Une base ne vit que dans « Bases »." : "Un dossier ne vit que dans « Bases ».";
  }
  if (!parent || parent.type === "page") return null;
  if (isBasesSide(parent)) return "« Bases » ne range que des bases et des dossiers.";
  return "Seule une page peut recevoir des sous-pages.";
}

// Parent de repli quand le parent d'origine manque ou refuse l'élément
// (restauration, réception d'une synchronisation) : la racine de « Bases »
// pour une base ou un dossier, la racine de l'arbre pour une page.
export function fallbackParent(type: PageKind): string | null {
  return livesInBases(type) ? BASES_ROOT_ID : null;
}

// Gestes interdits sur des pages à rôle fixe. Le Vide-cerveau ne part pas en
// corbeille : son épingle et la capture le supposent vivant (choix tranché à la
// construction de l'étape 16, BRAINSTORMING §14).
export function trashError(row: { isBasesRoot: boolean; isInbox: boolean }): string | null {
  if (row.isBasesRoot) return "« Bases » ne va pas à la corbeille.";
  if (row.isInbox) return "Le Vide-cerveau ne va pas à la corbeille.";
  return null;
}

export function publishError(row: Placeable): string | null {
  if (row.type === "folder") return "Un dossier de « Bases » ne se publie pas : publiez une base ou une page.";
  return null;
}
