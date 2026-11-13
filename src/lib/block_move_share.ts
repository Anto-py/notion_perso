// Ce qu'un déplacement de bloc change pour le public (étape 21, palier c).
//
// Une publication rend lisible une page, ce qui est rangé dessous (sauf une
// sous-page exclue) et, de lien en lien, des pages déjà lisibles ; une vue liée
// ouvre sa base entière. Déplacer un bloc peut donc faire entrer du contenu
// dans une publication (une page privée devient publique) ou l'en faire sortir.
// Cette fonction simule le graphe après le déplacement et compare ce qui est
// lisible avant et après : elle ne rend que des phrases à montrer avant d'écrire.
// Pure : le graphe vient de publication_query (loadShareGraph).

import { linkTargets, publicationOf, shareReach, type ShareGraph, type ShareNode } from "./publication.ts";

type Obj = Record<string, unknown>;

function isRecord(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Cibles que le bloc cite, relevées comme le fait loadShareGraph sur un corps
// (LINK_PATH et OPENS_PATH) : sous-pages propriétaires ou liens, vues liées,
// liens écrits dans une phrase. opens : les bases des seules vues liées.
export function blockRefs(blocks: readonly unknown[]): { links: string[]; opens: string[] } {
  const links: string[] = [];
  const opens: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const props = isRecord(value.props) ? value.props : {};
    if (value.type === "subpage" && typeof props.pageId === "string" && props.pageId) links.push(props.pageId);
    else if (value.type === "linked" && typeof props.databaseId === "string" && props.databaseId) {
      links.push(props.databaseId);
      opens.push(props.databaseId);
    } else if (value.type === "link" && typeof value.href === "string" && value.href.startsWith("/")) links.push(value.href);
    Object.values(value).forEach(visit);
  };
  visit(blocks);
  return { links: linkTargets(links), opens: linkTargets(opens) };
}

// Pages lisibles par au moins une publication.
function readableIds(graph: ShareGraph): Set<string> {
  const ids = new Set<string>();
  for (const node of graph.values()) {
    if (!node.publicId) continue;
    for (const id of shareReach(graph, node.id).keys()) ids.add(id);
  }
  return ids;
}

function descendantsOf(graph: ShareGraph, id: string): string[] {
  const found: string[] = [];
  for (const node of graph.values()) {
    if (node.id === id || node.type === "entry") continue;
    let up = node.parentId;
    for (let steps = 0; up && steps <= graph.size; steps++) {
      if (up === id) {
        found.push(node.id);
        break;
      }
      up = graph.get(up)?.parentId ?? null;
    }
  }
  return found;
}

// Un bloc qui n'est que des liens de sous-page n'a pas de contenu propre : son
// effet sur le public passe tout entier par les pages qu'il emporte.
function onlySubpages(blocks: readonly unknown[]): boolean {
  return blocks.every((block) => isRecord(block) && block.type === "subpage" && onlySubpages(Array.isArray(block.children) ? block.children : []));
}

function removeOnce(list: readonly string[], values: readonly string[]): string[] {
  const rest = [...list];
  for (const value of values) {
    const at = rest.indexOf(value);
    if (at !== -1) rest.splice(at, 1);
  }
  return rest;
}

const titleOf = (node: ShareNode | undefined) => node?.title || "Sans titre";

export function sharingWarnings(input: {
  graph: ShareGraph;
  sourceId: string;
  targetId: string | null;
  carried: readonly string[];
  blocks: readonly unknown[];
}): string[] {
  const { graph, sourceId, targetId, carried, blocks } = input;
  const refs = blockRefs(blocks);

  // Le graphe tel qu'il sera : les sous-pages emportées changent de mère, la
  // cible gagne les liens du bloc et la source les perd. Vers la racine, le
  // bloc devient une page privée qui ne cite rien au public.
  const next = new Map(graph);
  for (const id of carried) {
    const page = next.get(id);
    if (page) next.set(id, { ...page, parentId: targetId });
  }
  const source = next.get(sourceId);
  if (source) next.set(sourceId, { ...source, links: removeOnce(source.links, refs.links), opens: removeOnce(source.opens, refs.opens) });
  const target = targetId ? next.get(targetId) : undefined;
  if (target) next.set(target.id, { ...target, links: [...target.links, ...refs.links], opens: [...target.opens, ...refs.opens] });

  const before = readableIds(graph);
  const after = readableIds(next);
  const lines: string[] = [];

  // Où le contenu arrive, en une demi-phrase : la cible est-elle la page publiée
  // elle-même, ou rangée sous une page publiée ?
  const arrival = (): string => {
    const publication = targetId ? publicationOf(next, targetId) : null;
    if (!targetId || !publication) return "la page cible est publiée";
    return publication.rootId === targetId
      ? `« ${titleOf(next.get(targetId))} » est publiée`
      : `« ${titleOf(next.get(targetId))} » est dans la publication « ${titleOf(next.get(publication.rootId))} »`;
  };
  const departure = (id: string): string => {
    const publication = publicationOf(graph, id);
    return publication ? `la publication « ${titleOf(graph.get(publication.rootId))} »` : "une publication";
  };

  for (const id of carried) {
    const page = graph.get(id);
    if (!page) continue;
    const was = before.has(id);
    const now = after.has(id);
    if (was === now) continue;
    // Les descendantes qui basculent dans le même sens suivent la page.
    const followers = descendantsOf(graph, id).filter((child) => before.has(child) !== after.has(child) && after.has(child) === now).length;
    const extra = followers === 0 ? "" : followers === 1 ? " (et sa sous-page)" : ` (et ses ${followers} sous-pages)`;
    lines.push(
      now
        ? `« ${titleOf(page)} »${extra} deviendra lisible par le public : ${arrival()}.`
        : `« ${titleOf(page)} »${extra} ne sera plus lisible par le public : elle quitte ${departure(id)}.`,
    );
  }

  for (const baseId of new Set(refs.opens)) {
    const base = graph.get(baseId);
    if (!base || base.type !== "database") continue;
    const was = before.has(baseId);
    const now = after.has(baseId);
    if (was === now) continue;
    lines.push(
      now
        ? `La base « ${titleOf(base)} » deviendra lisible par le public : la vue liée de ce bloc l'ouvre, et ${arrival()}.`
        : `La base « ${titleOf(base)} » ne sera plus ouverte au public par ce bloc.`,
    );
  }

  if (!onlySubpages(blocks)) {
    const was = before.has(sourceId);
    const now = targetId !== null && after.has(targetId);
    if (!was && now) lines.push(`Le contenu de ce bloc deviendra lisible par le public : ${arrival()}.`);
    if (was && !now) lines.push(`Le contenu de ce bloc ne sera plus lisible par le public : il quitte ${departure(sourceId)}.`);
  }
  return lines;
}
