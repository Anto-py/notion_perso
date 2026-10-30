// Ce qu'une publication rend lisible (BRAINSTORMING §7) : la page publiée et
// tout ce qui descend d'elle, sous-pages, bases et leurs entrées, tant qu'aucun
// maillon n'est en corbeille. Pur : les lignes viennent de publication_query.

export type PublicNode = {
  id: string;
  type: "page" | "database" | "entry";
  parentId: string | null;
  dbId: string | null;
  trashed: boolean;
  // Non nul seulement si la page est publiée.
  publicId: string | null;
  title: string;
  icon: string | null;
};

// Une entrée descend de sa base, jamais d'un parent de l'arbre.
function upOf(node: PublicNode): string | null {
  return node.type === "entry" ? node.dbId : node.parentId;
}

// Chemin de la racine jusqu'à la page demandée, racine en tête ; null si la
// page ne descend d'aucune racine admise par isRoot, ou si un maillon est en
// corbeille. Le nombre de pas est borné : une boucle en base ne bloque rien.
export function publicChain(
  nodes: ReadonlyMap<string, PublicNode>,
  targetId: string,
  isRoot: (node: PublicNode) => boolean,
): PublicNode[] | null {
  const chain: PublicNode[] = [];
  let node = nodes.get(targetId);
  for (let steps = 0; node && steps <= nodes.size; steps++) {
    if (node.trashed) return null;
    chain.unshift(node);
    if (isRoot(node)) return chain;
    const up = upOf(node);
    node = up ? nodes.get(up) : undefined;
  }
  return null;
}

// Adresse publique d'une page : la racine par son seul identifiant, tout ce
// qui en descend sous lui.
export function publicHref(publicId: string, rootId: string, pageId: string): string {
  return pageId === rootId ? `/p/${publicId}` : `/p/${publicId}/${pageId}`;
}
