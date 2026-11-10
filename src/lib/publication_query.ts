// Partage public : publier, dépublier, exclure, et résoudre ce qu'un lien rend
// lisible. La règle (la portée d'une publication) est dans publication.ts ; ce
// module ne fait que ramener les lignes.
import { publishError } from "./bases";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { imageIcon } from "./icons";
import { newToken } from "./ids";
import { getPage, type Page } from "./pages";
import {
  closedBy,
  linkTargets,
  openedBases,
  openersOf,
  privateTargets,
  publicationOf,
  publishedBelow,
  reachPath,
  shareReach,
  treePath,
  type ShareGraph,
  type ShareNode,
} from "./publication";
import type { TreeRow } from "./tree";
import { vitrineReach } from "./vitrine_query";

// newToken : 32 octets en base64url. Une adresse d'une autre forme n'atteint
// même pas la base.
const PUBLIC_ID = /^[A-Za-z0-9_-]{43}$/;

// Blocs subpage et vues liées dont la cible est choisie, liens écrits dans une
// phrase vers un chemin du site. En mode strict, un champ absent rend le
// filtre inconnu, donc faux : aucune garde de forme n'est nécessaire.
const LINK_PATH =
  'strict $.** ? ((@.type == "subpage" && @.props.pageId != "") || (@.type == "linked" && @.props.databaseId != "") || (@.type == "link" && @.href starts with "/"))';
// Les bases des seules vues liées, qu'un passage ouvre (étape 16).
const OPENS_PATH = 'strict $.** ? (@.type == "linked" && @.props.databaseId != "").props.databaseId';

// Toutes les pages hors corbeille avec les cibles de leurs liens, en une
// requête, dans l'ordre de la sidebar. Le corps ne quitte pas la base : seul
// un tableau d'ids et d'adresses en sort, dans l'ordre du texte (WITH
// ORDINALITY). cache() : une seule lecture par rendu, métadonnées comprises.
export const loadShareGraph = cache(async (): Promise<ShareGraph> => {
  const result = await db.execute<{
    id: string;
    type: ShareNode["type"];
    parent_id: string | null;
    db_id: string | null;
    share_closed: boolean;
    public_id: string | null;
    title: string;
    icon: string | null;
    links: string[] | null;
    opens: string[] | null;
  }>(sql`
    SELECT p.id, p.type, p.parent_id, p.db_id, p.share_closed,
      CASE WHEN p.share_enabled THEN p.public_id END AS public_id, p.title, p.icon,
      (SELECT array_agg(coalesce(x -> 'props' ->> 'pageId', x -> 'props' ->> 'databaseId', x ->> 'href') ORDER BY ord)
        FROM jsonb_path_query(p.body, ${LINK_PATH}::jsonpath) WITH ORDINALITY AS t(x, ord)) AS links,
      (SELECT array_agg(x #>> '{}') FROM jsonb_path_query(p.body, ${OPENS_PATH}::jsonpath) AS t(x)) AS opens
    FROM pages p
    WHERE p.trashed_at IS NULL
    ORDER BY p.manual_order, p.created_at`);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        dbId: row.db_id,
        closed: row.share_closed,
        publicId: row.public_id,
        title: row.title,
        icon: row.icon,
        links: linkTargets(row.links ?? []),
        opens: linkTargets(row.opens ?? []),
      },
    ]),
  );
});

export type Publication = {
  root: Page;
  page: Page;
  // De la racine à la page demandée, par le chemin du visiteur.
  chain: ShareNode[];
  graph: ShareGraph;
  reach: ReadonlyMap<string, string | null>;
};

// Ce que sert /p/[publicId] (pageId absent) ou /p/[publicId]/[pageId] ; null
// pour un lien dépublié ou une page hors de la portée.
export async function resolvePublication(publicId: string, pageId?: string): Promise<Publication | null> {
  if (!PUBLIC_ID.test(publicId)) return null;
  const [root] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.publicId, publicId), eq(pages.shareEnabled, true), isNull(pages.trashedAt)))
    .limit(1);
  if (!root) return null;
  const targetId = pageId ?? root.id;
  const graph = await loadShareGraph();
  const reach = shareReach(graph, root.id);
  if (!reach.has(targetId)) return null;
  const page = targetId === root.id ? root : await getPage(targetId);
  return page ? { root, page, chain: reachPath(graph, reach, targetId), graph, reach } : null;
}

// Sous-pages et bases d'une page, dans l'ordre de la sidebar.
export async function listChildren(pageId: string) {
  return db
    .select({ id: pages.id, type: pages.type, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.parentId, pageId), isNull(pages.trashedAt), ne(pages.type, "entry"), eq(pages.isInbox, false)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

// Réunion des portées de toutes les publications et de la vitrine de veille,
// gardée 30 secondes : chaque média public la consulte. Sur globalThis, Next
// chargeant parfois deux fois un même module (instrumentation et route) ;
// publier, dépublier, exclure ou piloter la vitrine l'efface, pour qu'un média
// se ferme aussitôt.
const REACH_TTL_MS = 30_000;
type ReachMemo = { at: number; ids: Promise<Set<string>> };
const store = globalThis as typeof globalThis & { __notionPublicReach?: ReachMemo | null };

export function forgetPublicReach(): void {
  store.__notionPublicReach = null;
}

async function computePublicReach(): Promise<Set<string>> {
  const [graph, vitrine] = await Promise.all([loadShareGraph(), vitrineReach()]);
  const ids = new Set<string>(vitrine);
  for (const node of graph.values()) {
    if (!node.publicId) continue;
    for (const id of shareReach(graph, node.id).keys()) ids.add(id);
  }
  return ids;
}

function publicReachAll(): Promise<Set<string>> {
  const memo = store.__notionPublicReach;
  if (memo && Date.now() - memo.at < REACH_TTL_MS) return memo.ids;
  const ids = computePublicReach();
  store.__notionPublicReach = { at: Date.now(), ids };
  // Une lecture en échec ne reste pas en mémoire.
  ids.catch(() => {
    if (store.__notionPublicReach?.ids === ids) forgetPublicReach();
  });
  return ids;
}

// Un média est public s'il figure dans le corps d'une page lisible par un
// lien ou par la vitrine, s'il en est l'icône, ou s'il est l'image de son
// bandeau. C'est le corps qui compte, pas media.page_id : une image copiée
// dans une autre page y apparaît, une image retirée du corps n'est plus servie.
export async function isMediaPublic(filename: string): Promise<boolean> {
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        isNull(pages.trashedAt),
        // Cité dans le corps, icône de la page ou image de son bandeau.
        or(
          sql`strpos(${pages.body}::text, ${filename}) > 0`,
          eq(pages.icon, imageIcon(filename)),
          eq(pages.cover, imageIcon(filename)),
        ),
      ),
    );
  if (!rows.length) return false;
  const reach = await publicReachAll();
  return rows.some((row) => reach.has(row.id));
}

export type ShareRefusal = { ok: false; status: 409; error: string };

// Publier tire un identifiant neuf ; republier après une dépublication en
// tire un autre, l'ancien lien restant mort (choix d'Antonin du 2026-10-30).
// Une page déjà publiée garde le sien. Une page exclue, ou rangée sous une
// page exclue, ne se publie pas. updated_at inchangé : publier n'est pas
// modifier.
export async function publishPage(page: Page): Promise<{ ok: true; publicId: string } | ShareRefusal> {
  if (page.shareEnabled && page.publicId) return { ok: true, publicId: page.publicId };
  const refused = publishError(page);
  if (refused) return { ok: false, status: 409, error: refused };
  if (closedBy(await loadShareGraph(), page.id)) {
    return { ok: false, status: 409, error: "Cette page est exclue du partage : retirez l'exclusion d'abord." };
  }
  const publicId = newToken();
  await db
    .update(pages)
    .set({ shareEnabled: true, publicId, updatedAt: sql`${pages.updatedAt}` })
    .where(eq(pages.id, page.id));
  forgetPublicReach();
  return { ok: true, publicId };
}

export async function unpublishPage(page: Page): Promise<void> {
  await db
    .update(pages)
    .set({ shareEnabled: false, publicId: null, updatedAt: sql`${pages.updatedAt}` })
    .where(eq(pages.id, page.id));
  forgetPublicReach();
}

// Exclusion du partage des ancêtres : exclusive de la publication, d'où le
// refus sur une page publiée ou qui porte une page publiée dessous.
// updated_at inchangé, comme publier.
export async function setShareClosed(page: Page, closed: boolean): Promise<{ ok: true } | ShareRefusal> {
  if (closed && page.shareEnabled) {
    return { ok: false, status: 409, error: "Cette page est publiée : dépubliez-la avant de l'exclure." };
  }
  if (closed) {
    const [below] = publishedBelow(await loadShareGraph(), page.id);
    if (below) {
      return { ok: false, status: 409, error: `« ${below.title || "Sans titre"} », rangée dessous, est publiée : dépubliez-la d'abord.` };
    }
  }
  await db
    .update(pages)
    .set({ shareClosed: closed, updatedAt: sql`${pages.updatedAt}` })
    .where(eq(pages.id, page.id));
  forgetPublicReach();
  return { ok: true };
}

export type PrivateLink = { row: TreeRow; path: string[]; excluded: boolean };

type Named = { id: string; title: string };

// Base qu'une vue liée rend lisible sans publication : chemin dans « Bases »
// et page qui porte la vue.
export type OpenedBase = { row: TreeRow; path: string[]; host: Named };

const rowOf = (node: ShareNode): TreeRow => ({ id: node.id, parentId: node.parentId, type: node.type, title: node.title, icon: node.icon, closed: node.closed });
const named = (node: ShareNode): Named => ({ id: node.id, title: node.title });

export type ShareState = {
  type: ShareNode["type"];
  publicId: string | null;
  // Exclusion posée sur la page elle-même.
  closed: boolean;
  // L'ancêtre qui exclut la page, quand ce n'est pas elle.
  closedBy: { id: string; title: string } | null;
  // La publication d'un ancêtre qui rendrait la page lisible : l'exclusion
  // n'a de sens que là.
  sharedBy: { id: string; title: string } | null;
  // Page publiée : les cibles de ses liens, dans toute sa portée, où le
  // visiteur lit « Contenu privé ». excluded : la cible ne se publie pas.
  privateLinks: PrivateLink[];
  // Page publiée : les bases que ses vues liées ouvrent (étape 16).
  openedBases: OpenedBase[];
  // Base : les pages dont une vue liée l'ouvre, avec la page publiée qui
  // porte le partage.
  openedBy: { host: Named; root: Named }[];
};

// État du panneau « Partager ».
export async function shareState(page: Page): Promise<ShareState> {
  const graph = await loadShareGraph();
  const closer = closedBy(graph, page.id);
  const ancestor = closer && closer !== page.id ? graph.get(closer) : undefined;
  const up = page.type === "entry" ? page.dbId : page.parentId;
  const above = up ? publicationOf(graph, up) : null;
  const sharer = above ? graph.get(above.rootId) : undefined;
  const publicId = page.shareEnabled ? page.publicId : null;
  const reach = publicId ? shareReach(graph, page.id) : null;
  const privateLinks = reach
    ? privateTargets(graph, reach).map((node) => ({
        row: rowOf(node),
        path: treePath(graph, node.id),
        excluded: closedBy(graph, node.id) !== null,
      }))
    : [];
  const opened = reach
    ? openedBases(graph, reach).map(({ node, host }) => ({ row: rowOf(node), path: treePath(graph, node.id), host: named(host) }))
    : [];
  const openedBy =
    page.type === "database" && !publicId ? openersOf(graph, page.id).map(({ host, root }) => ({ host: named(host), root: named(root) })) : [];
  return {
    type: page.type,
    publicId,
    closed: page.shareClosed,
    closedBy: ancestor ? { id: ancestor.id, title: ancestor.title } : null,
    sharedBy: sharer && !ancestor ? { id: sharer.id, title: sharer.title } : null,
    privateLinks,
    openedBases: opened,
    openedBy,
  };
}
