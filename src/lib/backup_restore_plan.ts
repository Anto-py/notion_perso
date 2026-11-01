// Reprise d'une page d'une sauvegarde dans la base vive (palier d de l'étape
// 12) : ce que le clic décide, sans base ni disque. L'écriture est dans
// backup_restore.ts.
//
// Deux règles portent tout le reste. Une page encore présente garde son id, et
// sa version actuelle part en corbeille comme copie : rien ne se perd. Une page
// disparue prend un id neuf, parce que le serveur fait gagner la purge contre
// une modification et qu'un id purgé recréé serait effacé au cycle suivant.
import type { Page } from "./pages";
import { SUBPAGE_BLOCK } from "./blocks";
import { storedNamesIn } from "./media_cleanup";

export type SourcePage = Pick<
  Page,
  | "id"
  | "parentId"
  | "type"
  | "title"
  | "icon"
  | "cover"
  | "coverPosition"
  | "body"
  | "dbConfig"
  | "dbId"
  | "propertyValues"
  | "manualOrder"
  | "createdAt"
  | "updatedAt"
>;

// Ce que le plan a besoin de savoir de la base vive : la ligne existe-t-elle,
// où est-elle rangée, et en corbeille ou non.
export type LiveRef = { parentId: string | null; dbId: string | null; trashed: boolean };

export type PlannedPage = {
  // L'id sous lequel la page sera écrite dans la base vive.
  id: string;
  source: SourcePage;
  parentId: string | null;
  dbId: string | null;
  body: unknown;
};

export type PlannedCopy = { id: string; sourceId: string };

export type RecoveryPlan = {
  // Parents d'abord : une sous-page reprise après son parent.
  pages: PlannedPage[];
  // L'état actuel de chaque page reprise encore présente, sous un id neuf.
  copies: PlannedCopy[];
  // Fichiers cités par les pages reprises (corps, icône, bandeau).
  media: string[];
  // Une entrée dont la base n'existe plus dans la base vive et n'est pas dans
  // la sélection : rien ne s'écrit, l'appelant propose de reprendre sa base.
  blockedBy: string | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Les blocs de sous-page portent l'id de leur cible : un id renommé se reporte
// dans le corps, sinon le lien pointerait vers la page purgée.
function rewriteBody(body: unknown, rename: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(body)) return body;
  const visit = (blocks: unknown): unknown => {
    if (!Array.isArray(blocks)) return blocks;
    return blocks.map((block) => {
      if (!isObject(block)) return block;
      const copy: Record<string, unknown> = { ...block };
      if (copy.type === SUBPAGE_BLOCK && isObject(copy.props)) {
        const pageId = copy.props.pageId;
        if (typeof pageId === "string" && rename.has(pageId)) {
          copy.props = { ...copy.props, pageId: rename.get(pageId) };
        }
      }
      if ("children" in copy) copy.children = visit(copy.children);
      return copy;
    });
  };
  return visit(body);
}

// Profondeur dans l'ensemble repris : un parent absent de la sélection ne
// compte pas, une donnée bouclée s'arrête à zéro.
function depthsOf(source: readonly SourcePage[]): Map<string, number> {
  const byId = new Map(source.map((page) => [page.id, page]));
  const depths = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const page = byId.get(id);
    const parentId = page?.parentId;
    if (!parentId || !byId.has(parentId) || seen.has(id)) {
      depths.set(id, 0);
      return 0;
    }
    seen.add(id);
    const depth = depthOf(parentId, seen) + 1;
    depths.set(id, depth);
    return depth;
  };
  for (const page of source) depthOf(page.id, new Set());
  return depths;
}

export function planRecovery(
  source: readonly SourcePage[],
  live: ReadonlyMap<string, LiveRef>,
  newId: (prefix: string) => string,
): RecoveryPlan {
  const depths = depthsOf(source);
  const ordered = [...source].sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0) || a.id.localeCompare(b.id));

  // Un id déjà pris dans la base vive, corbeille comprise, se réutilise : la
  // page est là, on la réécrit sur place.
  const rename = new Map<string, string>();
  for (const page of ordered) rename.set(page.id, live.has(page.id) ? page.id : newId("pg"));

  const alive = (id: string): boolean => {
    const ref = live.get(id);
    return ref !== undefined && !ref.trashed;
  };

  const pages: PlannedPage[] = [];
  const copies: PlannedCopy[] = [];
  const media = new Set<string>();
  let blockedBy: string | null = null;

  for (const page of ordered) {
    const parentId = page.parentId === null ? null : (rename.get(page.parentId) ?? (alive(page.parentId) ? page.parentId : null));

    let dbId: string | null = null;
    if (page.type === "entry" && page.dbId) {
      dbId = rename.get(page.dbId) ?? (alive(page.dbId) ? page.dbId : null);
      // Une entrée ne vit que dans sa base : sans elle, rien ne s'écrit.
      if (!dbId) blockedBy ??= page.dbId;
    }

    for (const filename of storedNamesIn(JSON.stringify({ body: page.body, icon: page.icon, cover: page.cover }))) {
      media.add(filename);
    }

    pages.push({ id: rename.get(page.id)!, source: page, parentId, dbId, body: rewriteBody(page.body, rename) });
    if (live.has(page.id)) copies.push({ id: newId("pg"), sourceId: page.id });
  }

  return { pages, copies, media: [...media], blockedBy };
}
