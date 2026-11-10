// Arbre de la sidebar, calculé depuis la liste plate des pages. Module pur :
// importé par le serveur (contrôle du déplacement) comme par le navigateur
// (refus immédiat pendant le glisser-déposer).
import type { PageKind } from "./bases";
import { keyBetween } from "./order_key";
import { fold } from "./property_schema";

export type TreeRow = {
  id: string;
  parentId: string | null;
  type: PageKind;
  title: string;
  icon: string | null;
  // Exclusion du partage posée sur la page elle-même : cadenas dans la sidebar.
  closed: boolean;
  // La racine des bases et le Vide-cerveau (étapes 16 et 17) : rôles fixes,
  // absents des lignes qui ne viennent pas de listTreeRows.
  basesRoot?: boolean;
  inbox?: boolean;
  // La base à l'exception To Do : elle peut vivre à la racine de l'arbre.
  rootException?: boolean;
};

export type TreeNode = TreeRow & { children: TreeNode[] };

// Les lignes arrivent déjà triées : l'ordre des frères est conservé. Une page
// dont le parent est absent de la liste (en corbeille) remonte à la racine,
// pour ne jamais disparaître de la sidebar.
export function buildTree(rows: TreeRow[]): TreeNode[] {
  const nodes = new Map(rows.map((row) => [row.id, { ...row, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// Zones d'insertion du glisser (entre deux lignes) : l'identifiant porte le
// parent d'accueil et la ligne devant laquelle insérer, null signifiant la fin
// de la liste. Les identifiants de page ne contiennent pas « : ».
export const GAP_PREFIX = "__gap__";

export function gapId(parentId: string | null, beforeId: string | null): string {
  return `${GAP_PREFIX}${parentId ?? ""}:${beforeId ?? ""}`;
}

export function parseGapId(id: string): { parentId: string | null; beforeId: string | null } | null {
  if (!id.startsWith(GAP_PREFIX)) return null;
  const rest = id.slice(GAP_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut === -1) return null;
  const parent = rest.slice(0, cut);
  const before = rest.slice(cut + 1);
  return { parentId: parent || null, beforeId: before || null };
}

// Clé d'ordre d'une insertion devant beforeId (null : à la fin), dans une
// liste de frères déjà triée. La page déplacée doit en être exclue.
export function orderBefore(siblings: readonly { id: string; manualOrder: string }[], beforeId: string | null): string {
  const index = beforeId ? siblings.findIndex((row) => row.id === beforeId) : -1;
  if (beforeId && index === -1) throw new Error("Ligne de référence introuvable");
  const at = index === -1 ? siblings.length : index;
  return keyBetween(siblings[at - 1]?.manualOrder ?? null, siblings[at]?.manualOrder ?? null);
}

// Placer pageId sous newParentId crée-t-il une boucle ? Oui si le nouveau
// parent est la page elle-même ou l'une de ses descendantes, ce qu'on voit en
// remontant les ancêtres du nouveau parent. Le compteur borne la remontée si la
// base contenait déjà une boucle.
export function wouldCreateCycle(
  parentOf: ReadonlyMap<string, string | null>,
  pageId: string,
  newParentId: string | null,
): boolean {
  let current = newParentId;
  for (let steps = 0; current !== null && steps <= parentOf.size; steps++) {
    if (current === pageId) return true;
    current = parentOf.get(current) ?? null;
  }
  return current !== null;
}

// Cible d'un bloc-lien absente de l'arbre : la page serveur dit pourquoi.
export type AbsentTarget = "trashed" | "deleted";

export type LinkChoice = { row: TreeRow; path: string[] };

// Pages et bases qu'un « Lien vers une page » peut viser : tout l'arbre sauf la
// page hôte, les entrées et les dossiers de « Bases » (qui restent dans le
// chemin), dans l'ordre de la sidebar, filtré par le titre
// sans casse ni accents. Le chemin (titres des ancêtres, de la racine au
// parent) départage deux homonymes ; la recherche ne le lit pas.
export function linkChoices(rows: readonly TreeRow[], hostId: string, query: string): LinkChoice[] {
  const wanted = fold(query.trim());
  const choices: LinkChoice[] = [];
  const visit = (nodes: TreeNode[], path: string[]) => {
    for (const node of nodes) {
      const { children, ...row } = node;
      const title = row.title || "Sans titre";
      if (row.id !== hostId && row.type !== "entry" && row.type !== "folder" && fold(title).includes(wanted)) choices.push({ row, path });
      visit(children, [...path, title]);
    }
  };
  visit(buildTree([...rows]), []);
  return choices;
}

// Ids des ancêtres d'une page, du parent direct à la racine : la sidebar les
// déplie pour montrer la page ouverte.
export function ancestorsOf(parentOf: ReadonlyMap<string, string | null>, pageId: string): string[] {
  const ancestors: string[] = [];
  let current = parentOf.get(pageId) ?? null;
  while (current !== null && !ancestors.includes(current)) {
    ancestors.push(current);
    current = parentOf.get(current) ?? null;
  }
  return ancestors;
}

// Ancêtres d'une page dans l'ordre de lecture, de la racine au parent direct :
// le fil « Bases / Cours » de l'écran d'une base ou d'un dossier.
export function ancestorRows(rows: readonly TreeRow[], pageId: string): TreeRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  return ancestorsOf(parentOf, pageId)
    .flatMap((id) => byId.get(id) ?? [])
    .reverse();
}
