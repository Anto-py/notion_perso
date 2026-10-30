// Arbre de la sidebar, calculé depuis la liste plate des pages. Module pur :
// importé par le serveur (contrôle du déplacement) comme par le navigateur
// (refus immédiat pendant le glisser-déposer).

export type TreeRow = {
  id: string;
  parentId: string | null;
  type: "page" | "database" | "entry";
  title: string;
  icon: string | null;
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

// Libellé affiché d'une page : icône (document par défaut) et titre.
export function label(row: Pick<TreeRow, "icon" | "title">): string {
  return `${row.icon ?? "📄"} ${row.title || "Sans titre"}`;
}
