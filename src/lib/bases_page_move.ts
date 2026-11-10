// Conversion de la racine des bases (étape 17, palier c) : la page « Bases de
// données » prend le rôle, les bases y sont encastrées, les pages vides du même
// nom partent à la corbeille, l'ancien dossier technique aussi. Module pur : il
// dit ce qu'il faut écrire, le script `bases_page_move.mts` l'applique.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { LINKED_BLOCK, SUBPAGE_BLOCK, flattenToText } from "./blocks.ts";
import type { PageKind } from "./bases.ts";

type Json = unknown;
type Block = Record<string, Json>;

export const ROOT_PAGE_TITLE = "Bases de données";
// Pages vides que leurs bases remplacent (choix d'Antonin du 2026-11-10).
export const EMPTY_PAGE_TITLES = ["Bot's", "Exemples TICE", "Prompts", "Ressources numériques", "To Do"];

export type ConvertRow = {
  id: string;
  parentId: string | null;
  type: PageKind;
  title: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number | null;
  body: Json;
  trashed: boolean;
  isBasesRoot: boolean;
  isInbox: boolean;
  // Entrées vivantes de la base ; sert à départager deux bases homonymes.
  liveEntries: number;
  manualOrder: string;
};

export type BasePatch = {
  parentId?: string;
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number | null;
  trash?: boolean;
};

export type ConversionPlan = {
  rootId: string;
  oldRootId: string | null;
  // Base -> champs à écrire (déménagement, décoration reprise, corbeille).
  bases: Map<string, BasePatch>;
  // Page racine : corps converti et rôle.
  page: { body: Json[]; bodyText: string; roleChanged: boolean; bodyChanged: boolean };
  trashPageIds: string[];
  duplicates: string[];
  report: {
    transfers: number;
    moves: number;
    duplicates: number;
    embedded: number;
    replaced: number;
    added: number;
    trashedPages: number;
    roleChanged: boolean;
  };
};

export class ConversionError extends Error {}

const isObject = (value: Json): value is Block => typeof value === "object" && value !== null && !Array.isArray(value);
const propsOf = (block: Block): Block => (isObject(block.props) ? block.props : {});

// Titres comparés sans casse, sans accents et avec l'apostrophe droite : la
// page s'appelle « Bot’s » à l'écran et « Bot's » dans les décisions.
export function normTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘]/g, "'")
    .trim()
    .toLowerCase();
}

function embedBlockFor(databaseId: string, id: string, children: Json = []): Block {
  return { id, type: LINKED_BLOCK, props: { databaseId, config: "", embed: true }, children: Array.isArray(children) ? children : [] };
}

export function planBasesPage(rows: readonly ConvertRow[]): ConversionPlan {
  const live = rows.filter((row) => !row.trashed);
  const rootPage = live.find((row) => row.type === "page" && normTitle(row.title) === normTitle(ROOT_PAGE_TITLE));
  if (!rootPage) throw new ConversionError(`Page « ${ROOT_PAGE_TITLE} » introuvable ou en corbeille.`);

  const oldRoot = live.find((row) => row.isBasesRoot && row.id !== rootPage.id) ?? null;
  const liveBases = live.filter((row) => row.type === "database");

  // Deux bases homonymes : on garde celle qui a le plus d'entrées vivantes, les
  // autres ne partent que si elles n'en ont aucune (le doublon To Do de 13h03).
  const groups = new Map<string, ConvertRow[]>();
  for (const base of liveBases) {
    const key = normTitle(base.title || "Sans titre");
    groups.set(key, [...(groups.get(key) ?? []), base]);
  }
  const duplicates: ConvertRow[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [keep, ...rest] = [...group].sort(
      (a, b) => b.liveEntries - a.liveEntries || a.manualOrder.localeCompare(b.manualOrder) || a.id.localeCompare(b.id),
    );
    if (keep.liveEntries <= 0) continue; // rien à départager, on ne jette pas au hasard
    duplicates.push(...rest.filter((base) => base.liveEntries === 0));
  }
  const duplicateIds = new Set(duplicates.map((base) => base.id));
  const keptBases = liveBases.filter((base) => !duplicateIds.has(base.id));
  const baseByTitle = new Map(keptBases.map((base) => [normTitle(base.title || "Sans titre"), base]));

  const bases = new Map<string, BasePatch>();
  const patchOf = (id: string): BasePatch => bases.get(id) ?? {};
  const setPatch = (id: string, patch: BasePatch) => bases.set(id, { ...patchOf(id), ...patch });

  // 1. Les pages vides du même nom cèdent emoji, bandeau et cadrage. Seules
  //    celles rangées sur la page racine comptent : « Ressources numériques »
  //    existe aussi sous « Ressources », et ce n'est pas elle qu'on remplace.
  const emptyPages = live.filter(
    (row) =>
      row.type === "page" &&
      row.parentId === rootPage.id &&
      EMPTY_PAGE_TITLES.some((title) => normTitle(title) === normTitle(row.title)),
  );
  let transfers = 0;
  for (const page of emptyPages) {
    const base = baseByTitle.get(normTitle(page.title));
    if (!base) continue;
    const patch: BasePatch = {};
    if (page.icon !== null) patch.icon = page.icon;
    if (page.cover !== null) {
      patch.cover = page.cover;
      patch.coverPosition = page.coverPosition;
    }
    if (Object.keys(patch).length === 0) continue;
    setPatch(base.id, patch);
    transfers++;
  }

  // 2. Toutes les bases restantes rejoignent la page racine.
  const moved = keptBases.filter((base) => base.parentId !== rootPage.id);
  for (const base of moved) setPatch(base.id, { parentId: rootPage.id });
  for (const duplicate of duplicates) setPatch(duplicate.id, { trash: true });

  // 3. Corps de la page : blocs liés passés en encastré, blocs de sous-page des
  // pages remplacées devenus des bases encastrées, bases absentes ajoutées.
  const emptyPageToBase = new Map<string, string>();
  for (const page of emptyPages) {
    const base = baseByTitle.get(normTitle(page.title));
    if (base) emptyPageToBase.set(page.id, base.id);
  }
  let embedded = 0;
  let replaced = 0;
  const visit = (blocks: Json): Json[] => {
    if (!Array.isArray(blocks)) return [];
    return blocks.map((block) => {
      if (!isObject(block)) return block;
      const props = propsOf(block);
      if (block.type === LINKED_BLOCK) {
        const databaseId = typeof props.databaseId === "string" ? props.databaseId : "";
        if (databaseId && props.embed !== true) {
          embedded++;
          return { ...block, props: { ...props, embed: true } };
        }
        return block;
      }
      if (block.type === SUBPAGE_BLOCK && props.link !== true && typeof props.pageId === "string") {
        const databaseId = emptyPageToBase.get(props.pageId);
        if (databaseId) {
          replaced++;
          return embedBlockFor(databaseId, typeof block.id === "string" ? block.id : `embed-${databaseId}`, block.children);
        }
      }
      return "children" in block ? { ...block, children: visit(block.children) } : block;
    });
  };
  const body = visit(rootPage.body);

  // Bases déjà montrées par un bloc lié, quel qu'il soit.
  const shown = new Set<string>();
  const collect = (blocks: Json) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isObject(block)) continue;
      const props = propsOf(block);
      if (block.type === LINKED_BLOCK && typeof props.databaseId === "string" && props.databaseId) shown.add(props.databaseId);
      if ("children" in block) collect(block.children);
    }
  };
  collect(body);
  const missing = keptBases
    .filter((base) => !base.isInbox && !shown.has(base.id))
    .sort((a, b) => a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id));
  for (const base of missing) body.push(embedBlockFor(base.id, `embed-${base.id}`));

  // 4. Pages vides à la corbeille, ancien dossier aussi, une fois vide.
  const trashPageIds = emptyPages.map((page) => page.id);
  if (oldRoot) {
    const leaving = new Set([...moved.map((base) => base.id), ...duplicateIds, ...trashPageIds]);
    const leftover = live.filter((row) => row.parentId === oldRoot.id && !leaving.has(row.id));
    if (leftover.length > 0) {
      throw new ConversionError(
        `« ${oldRoot.title || "Bases"} » n'est pas vide : ${leftover.map((row) => row.title || "Sans titre").join(", ")}.`,
      );
    }
  }

  return {
    rootId: rootPage.id,
    oldRootId: oldRoot?.id ?? null,
    bases,
    page: {
      body,
      bodyText: flattenToText(body),
      roleChanged: !rootPage.isBasesRoot,
      bodyChanged: embedded + replaced + missing.length > 0,
    },
    trashPageIds,
    duplicates: duplicates.map((base) => base.id),
    report: {
      transfers,
      moves: moved.length,
      duplicates: duplicates.length,
      embedded,
      replaced,
      added: missing.length,
      trashedPages: trashPageIds.length,
      roleChanged: !rootPage.isBasesRoot,
    },
  };
}

// Une ligne lisible par passage, pour l'essai à blanc.
export function describePlan(plan: ConversionPlan, titles: ReadonlyMap<string, string>): string[] {
  const name = (id: string) => titles.get(id) || "Sans titre";
  const lines = [
    `Racine : « ${name(plan.rootId)} »${plan.page.roleChanged ? " reçoit le rôle" : " porte déjà le rôle"}.`,
    `Transferts de décoration : ${plan.report.transfers}.`,
    `Déplacements sous la racine : ${plan.report.moves}.`,
    `Doublons en corbeille : ${plan.report.duplicates}${plan.duplicates.length ? ` (${plan.duplicates.map(name).join(", ")})` : ""}.`,
    `Corps de la page : ${plan.report.embedded} blocs liés passés en encastré, ${plan.report.replaced} sous-pages converties, ${plan.report.added} bases ajoutées.`,
    `Pages vides en corbeille : ${plan.report.trashedPages}.`,
    plan.oldRootId ? `Ancien dossier « ${name(plan.oldRootId)} » : rôle retiré, corbeille.` : "Ancien dossier : aucun.",
  ];
  for (const [id, patch] of plan.bases) {
    const what = [
      patch.parentId ? "rangée sous la racine" : "",
      patch.icon !== undefined ? "emoji" : "",
      patch.cover !== undefined ? "bandeau" : "",
      patch.trash ? "corbeille" : "",
    ].filter(Boolean);
    lines.push(`- ${name(id)} : ${what.join(", ") || "inchangée"}.`);
  }
  return lines;
}
