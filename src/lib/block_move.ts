// Règles pures du « Déplacer vers… » du menu de bloc (étape 21, palier c).
//
// Le navigateur envoie le bloc (enfants compris) et la cible ; ces règles disent
// quelles sous-pages il emporte, si la cible est permise, et quel titre donner à
// la page née d'un bloc envoyé à la racine. Les mêmes fonctions servent côté
// navigateur (refus immédiat) et côté serveur (refus qui fait foi).

import { flattenToText, ownerRefs, SUBPAGE_BLOCK } from "./blocks.ts";
import { wouldCreateCycle } from "./tree.ts";

// Ce que les règles lisent d'une page : de quoi la situer dans l'arbre.
export type MoveRow = {
  parentId: string | null;
  type: string;
  trashed?: boolean;
  isBasesRoot?: boolean;
};

const TITLE_CUT = 100;
const BLOCKS_MAX = 50;
const DEPTH_MAX = 32;

function isBlock(value: unknown, depth: number): boolean {
  if (depth > DEPTH_MAX || typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { type, props, children } = value as Record<string, unknown>;
  if (typeof type !== "string" || type === "") return false;
  if (props !== undefined && (typeof props !== "object" || props === null || Array.isArray(props))) return false;
  if (children === undefined) return true;
  return Array.isArray(children) && children.every((child) => isBlock(child, depth + 1));
}

// Garde de forme du bloc que le navigateur envoie : de vrais blocs (un type,
// des props en objet, des enfants en liste), à profondeur bornée. Le contenu en
// ligne n'est pas inspecté, comme à l'enregistrement d'une page (PATCH).
export function isBlockList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= BLOCKS_MAX && value.every((block) => isBlock(block, 0));
}

// Sous-pages que le bloc emporte : celles dont il porte un bloc propriétaire
// (un lien ne compte pas) et qui sont de vraies pages filles de la source. Une
// page qui vit ailleurs, une base ou une page en corbeille voyage comme simple
// bloc, sans changer de mère.
export function carriedSubpages(blocks: readonly unknown[], sourceId: string, rows: ReadonlyMap<string, MoveRow>): string[] {
  return [...ownerRefs(blocks).keys()].filter((id) => {
    const row = rows.get(id);
    return row !== undefined && row.parentId === sourceId && row.type === "page" && !row.trashed;
  });
}

// Le bloc n'est qu'une sous-page propriétaire que la source possède vraiment :
// envoyé à la racine, c'est elle qui remonte, sans page neuve. Rend son id.
export function soleSubpage(blocks: readonly unknown[], carried: readonly string[]): string | null {
  if (blocks.length !== 1) return null;
  const block = blocks[0];
  if (typeof block !== "object" || block === null) return null;
  const { type, props } = block as { type?: unknown; props?: Record<string, unknown> };
  if (type !== SUBPAGE_BLOCK || props?.link === true) return null;
  const pageId = props?.pageId;
  return typeof pageId === "string" && carried.includes(pageId) ? pageId : null;
}

// Titre d'une page née d'un bloc : sa première ligne de texte, espaces ramenés
// à un, coupée à cent caractères entiers. Vide sans texte : l'application
// affiche alors « Sans titre ».
export function blockTitle(blocks: readonly unknown[]): string {
  const first = flattenToText(blocks).split("\n")[0] ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  const letters = [...line];
  return letters.length > TITLE_CUT ? `${letters.slice(0, TITLE_CUT).join("").trimEnd()}…` : line;
}

// Refus du déplacement, en une phrase, ou null. rows : l'annuaire des pages
// (id → ligne). carried : les sous-pages que le bloc emporte (carriedSubpages).
export function blockMoveError(input: {
  sourceId: string;
  targetId: string | null;
  carried: readonly string[];
  rows: ReadonlyMap<string, MoveRow>;
}): string | null {
  const { sourceId, targetId, carried, rows } = input;
  if (carried.some((id) => rows.get(id)?.isBasesRoot)) return "« Bases de données » reste sous « Ressources ».";
  if (targetId === null) return null;
  if (targetId === sourceId) return "Le bloc est déjà dans cette page.";
  const target = rows.get(targetId);
  if (!target || target.trashed) return "La page cible est introuvable ou en corbeille.";
  if (target.type === "folder" || target.type === "database") return "Un dossier ou une base ne reçoit pas de blocs.";
  if (target.type === "entry" && carried.length > 0) return "Une entrée de base ne reçoit pas de sous-pages : ce bloc en contient.";
  const parentOf = new Map([...rows].map(([id, row]) => [id, row.parentId]));
  if (carried.some((id) => wouldCreateCycle(parentOf, id, targetId))) {
    return "Le bloc ne peut pas entrer dans sa propre descendance : la cible est l'une de ses sous-pages.";
  }
  return null;
}
