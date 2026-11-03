// Ce qu'une publication rend lisible (BRAINSTORMING §7) : la page publiée et
// ce qui est rangé dessous, sauf une sous-page exclue et ses descendantes ;
// puis, de lien en lien, les pages publiées que ses liens citent, lues sous
// la même adresse. Un lien ne rend rien lisible : il mène seulement à ce qui
// l'est déjà. Pur : le graphe vient de publication_query (loadShareGraph).
import { internalLinkId } from "./blocks";

export type ShareNode = {
  id: string;
  type: "page" | "database" | "entry";
  parentId: string | null;
  dbId: string | null;
  // Exclusion posée sur la page elle-même (colonne share_closed) : la page et
  // ses descendantes sortent du partage de leurs ancêtres.
  closed: boolean;
  // Non nul seulement si la page est publiée.
  publicId: string | null;
  title: string;
  icon: string | null;
  // Cibles des liens du corps dans l'ordre du texte : blocs subpage (liens ou
  // non), bases des vues liées, liens écrits dans une phrase.
  links: string[];
};

// Pages hors corbeille, dans l'ordre de la sidebar. trashPage jette tout un
// sous-arbre : une page vivante n'a jamais d'ancêtre en corbeille.
export type ShareGraph = ReadonlyMap<string, ShareNode>;

const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Cibles relevées dans un corps par loadShareGraph : un id nu (bloc subpage,
// vue liée) ou une adresse interne (lien en ligne). Le reste est écarté.
export function linkTargets(raw: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.startsWith("/") ? internalLinkId(value) : ROW_ID.test(value) ? value : null;
    if (id) ids.push(id);
  }
  return ids;
}

// Une entrée descend de sa base, jamais d'un parent de l'arbre.
function upOf(node: ShareNode): string | null {
  return node.type === "entry" ? node.dbId : node.parentId;
}

// La page, ou l'ancêtre le plus proche, qui porte l'exclusion ; null si rien
// ne l'exclut. Bornée : une boucle en base ne bloque rien.
export function closedBy(graph: ShareGraph, id: string): string | null {
  let node = graph.get(id);
  for (let steps = 0; node && steps <= graph.size; steps++) {
    if (node.closed) return node.id;
    const up = upOf(node);
    node = up ? graph.get(up) : undefined;
  }
  return null;
}

// Publication qui rend la page lisible : elle-même si elle est publiée, sinon
// l'ancêtre publié le plus proche, à condition qu'aucune exclusion ne s'y
// interpose. Une page publiée sous une page exclue garde sa propre
// publication : l'exclusion ne retire que du partage des ancêtres.
export function publicationOf(graph: ShareGraph, id: string): { publicId: string; rootId: string } | null {
  let node = graph.get(id);
  for (let steps = 0; node && steps <= graph.size; steps++) {
    if (node.publicId) return { publicId: node.publicId, rootId: node.id };
    if (node.closed) return null;
    const up = upOf(node);
    node = up ? graph.get(up) : undefined;
  }
  return null;
}

// Pages publiées rangées sous la page (elle exclue) : l'exclusion leur est
// refusée tant qu'il en reste une, publier et exclure s'excluant.
export function publishedBelow(graph: ShareGraph, id: string): ShareNode[] {
  const below: ShareNode[] = [];
  for (const node of graph.values()) {
    if (!node.publicId || node.id === id) continue;
    let up = upOf(node);
    for (let steps = 0; up && steps <= graph.size; steps++) {
      if (up === id) {
        below.push(node);
        break;
      }
      const parent = graph.get(up);
      up = parent ? upOf(parent) : null;
    }
  }
  return below;
}

// Enfants de chaque nœud, dans l'ordre du graphe : sous-pages et bases par
// parent_id, entrées par db_id.
function childIndex(graph: ShareGraph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of graph.values()) {
    const up = upOf(node);
    if (!up) continue;
    const list = children.get(up);
    if (list) list.push(node.id);
    else children.set(up, [node.id]);
  }
  return children;
}

// Portée d'une publication : parcours en largeur depuis la racine, enfants de
// l'arbre d'abord (une page exclue n'est ni rendue ni traversée), puis liens
// dans l'ordre du corps, vers les seules pages déjà lisibles par une
// publication (publicationOf). Rend chaque page atteinte avec la page d'où on
// l'a atteinte (null pour la racine) : l'appartenance décide l'accès sous
// cette adresse, le précédent trace le fil d'Ariane. Une boucle de liens ne
// bloque rien, une page n'étant visitée qu'une fois.
export function shareReach(graph: ShareGraph, rootId: string): Map<string, string | null> {
  const reach = new Map<string, string | null>();
  if (!graph.has(rootId)) return reach;
  const children = childIndex(graph);
  reach.set(rootId, null);
  const queue = [rootId];
  const visit = (next: string, from: string) => {
    reach.set(next, from);
    queue.push(next);
  };
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const child of children.get(id) ?? []) {
      if (!reach.has(child) && !graph.get(child)!.closed) visit(child, id);
    }
    for (const target of graph.get(id)!.links) {
      if (!reach.has(target) && graph.has(target) && publicationOf(graph, target)) visit(target, id);
    }
  }
  return reach;
}

// Chemin de la racine jusqu'à la page, racine en tête, par les précédents de
// la portée ; vide si la page n'en fait pas partie.
export function reachPath(graph: ShareGraph, reach: ReadonlyMap<string, string | null>, id: string): ShareNode[] {
  const path: ShareNode[] = [];
  let current: string | null | undefined = reach.has(id) ? id : undefined;
  while (current && path.length <= reach.size) {
    const node = graph.get(current);
    if (!node) return [];
    path.unshift(node);
    current = reach.get(current);
  }
  return path;
}

// Cibles des liens de la portée que le visiteur ne peut pas lire (non
// publiées, ou exclues) : il y lit « Contenu privé ». Le panneau « Partager »
// les liste, chacune une fois, dans l'ordre du parcours.
export function privateTargets(graph: ShareGraph, reach: ReadonlyMap<string, string | null>): ShareNode[] {
  const seen = new Set<string>();
  const found: ShareNode[] = [];
  for (const id of reach.keys()) {
    for (const target of graph.get(id)!.links) {
      const node = graph.get(target);
      if (!node || reach.has(target) || seen.has(target)) continue;
      seen.add(target);
      found.push(node);
    }
  }
  return found;
}

// Titres des ancêtres d'une page, de la racine au parent : départage deux
// homonymes dans le panneau.
export function treePath(graph: ShareGraph, id: string): string[] {
  const path: string[] = [];
  const start = graph.get(id);
  let up = start ? upOf(start) : null;
  while (up && path.length <= graph.size) {
    const node = graph.get(up);
    if (!node) break;
    path.unshift(node.title || "Sans titre");
    up = upOf(node);
  }
  return path;
}

// Adresse publique d'une page : la racine par son seul identifiant, tout ce
// qu'elle rend lisible sous lui.
export function publicHref(publicId: string, rootId: string, pageId: string): string {
  return pageId === rootId ? `/p/${publicId}` : `/p/${publicId}/${pageId}`;
}
