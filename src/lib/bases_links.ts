// Bases en liens dans « Bases de données » (choix d'Antonin du 2026-11-11,
// SPECS « Racine dans « Bases de données » ») : chaque bloc « linked » du corps
// de la page racine, encastré ou non, devient un bloc « subpage » qui montre
// l'icône et le nom de la base, comme une sous-page. Module pur : il dit quoi
// écrire, bases_links_query.ts l'applique une fois.
//
// Le bloc garde son id : un éditeur resté ouvert sur la page fusionne sans
// conflit (seul le serveur a changé ce bloc). Une base qui vit sous la page
// reçoit un bloc propriétaire (link: false, sans ↗) ; une base rangée ailleurs,
// en corbeille ou inconnue, un lien (link: true), qui n'a aucun pouvoir sur
// elle.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { LINKED_BLOCK, SUBPAGE_BLOCK, flattenToText } from "./blocks.ts";

type Json = unknown;
type Block = Record<string, Json>;

export type LinkBase = { id: string; parentId: string | null; trashed: boolean };

export type LinksPlan = {
  body: Json[];
  bodyText: string;
  owners: number;
  links: number;
  changed: boolean;
};

const isBlock = (value: Json): value is Block => typeof value === "object" && value !== null && !Array.isArray(value);

export function planBasesLinks(body: Json, rootId: string, bases: readonly LinkBase[]): LinksPlan {
  const byId = new Map(bases.map((row) => [row.id, row]));
  let owners = 0;
  let links = 0;

  const convert = (block: Json): Json => {
    if (!isBlock(block)) return block;
    const children = Array.isArray(block.children) ? block.children.map(convert) : block.children;
    const props = isBlock(block.props) ? block.props : {};
    const databaseId = props.databaseId;
    if (block.type !== LINKED_BLOCK || typeof databaseId !== "string" || !databaseId) {
      return Array.isArray(block.children) ? { ...block, children } : block;
    }
    const row = byId.get(databaseId);
    const owned = row !== undefined && !row.trashed && row.parentId === rootId;
    if (owned) owners++;
    else links++;
    return {
      id: block.id,
      type: SUBPAGE_BLOCK,
      props: { pageId: databaseId, kind: "database", link: !owned },
      children: Array.isArray(children) ? children : [],
    };
  };

  const next = Array.isArray(body) ? body.map(convert) : [];
  return { body: next, bodyText: flattenToText(next), owners, links, changed: owners + links > 0 };
}

// Une ligne de journal, lue au déploiement dans les journaux du conteneur.
export function describeLinksPlan(plan: LinksPlan): string {
  const total = plan.owners + plan.links;
  if (total === 0) return "Aucune base à passer en lien.";
  return `${total} bases passées en lien (${plan.owners} sous-page${plan.owners > 1 ? "s" : ""}, ${plan.links} lien${plan.links > 1 ? "s" : ""} vers une base rangée ailleurs).`;
}
