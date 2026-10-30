// Partage public : publier, dépublier, et résoudre ce qu'un lien rend lisible.
// La règle (descendre d'une page publiée, sans maillon en corbeille) est dans
// publication.ts ; ce module ne fait que ramener les lignes.
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { imageIcon } from "./icons";
import { newToken } from "./ids";
import { getPage, type Page } from "./pages";
import { publicChain, type PublicNode } from "./publication";

// newToken : 32 octets en base64url. Une adresse d'une autre forme n'atteint
// même pas la base.
const PUBLIC_ID = /^[A-Za-z0-9_-]{43}$/;

// Profondeur maximale remontée : bien au-delà d'un arbre réel, elle arrête une
// boucle éventuelle (UNION ALL ne dédoublonne pas, la profondeur variant).
const MAX_DEPTH = 64;

// Les pages demandées et tous leurs ascendants, en une requête : une entrée
// remonte par sa base, une page par son parent.
async function withAncestors(ids: readonly string[]): Promise<Map<string, PublicNode>> {
  if (!ids.length) return new Map();
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute<{
    id: string;
    type: PublicNode["type"];
    parent_id: string | null;
    db_id: string | null;
    trashed: boolean;
    public_id: string | null;
    title: string;
    icon: string | null;
  }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, type, parent_id, db_id, trashed_at, share_enabled, public_id, title, icon, 0 AS depth
      FROM pages WHERE id IN (${list})
      UNION ALL
      SELECT p.id, p.type, p.parent_id, p.db_id, p.trashed_at, p.share_enabled, p.public_id, p.title, p.icon, up.depth + 1
      FROM pages p JOIN up ON p.id = CASE WHEN up.type = 'entry' THEN up.db_id ELSE up.parent_id END
      WHERE up.depth < ${MAX_DEPTH}
    )
    SELECT DISTINCT id, type, parent_id, db_id, trashed_at IS NOT NULL AS trashed,
      CASE WHEN share_enabled THEN public_id END AS public_id, title, icon
    FROM up`);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        dbId: row.db_id,
        trashed: row.trashed,
        publicId: row.public_id,
        title: row.title,
        icon: row.icon,
      },
    ]),
  );
}

export type Publication = { root: Page; page: Page; chain: PublicNode[] };

// Ce que sert /p/[publicId] (pageId absent) ou /p/[publicId]/[pageId] ; null
// pour un lien dépublié, une page en corbeille ou hors du sous-arbre publié.
export async function resolvePublication(publicId: string, pageId?: string): Promise<Publication | null> {
  if (!PUBLIC_ID.test(publicId)) return null;
  const [root] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.publicId, publicId), eq(pages.shareEnabled, true), isNull(pages.trashedAt)))
    .limit(1);
  if (!root) return null;
  const targetId = pageId ?? root.id;
  const nodes = await withAncestors([targetId]);
  const chain = publicChain(nodes, targetId, (node) => node.id === root.id);
  if (!chain) return null;
  const page = targetId === root.id ? root : await getPage(targetId);
  return page ? { root, page, chain } : null;
}

// Sous-pages et bases d'une page, dans l'ordre de la sidebar.
export async function listChildren(pageId: string) {
  return db
    .select({ id: pages.id, type: pages.type, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.parentId, pageId), isNull(pages.trashedAt), ne(pages.type, "entry"), eq(pages.isInbox, false)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
}

// Un média est public s'il figure dans le corps d'une page lisible par un
// lien, ou s'il en est l'icône. C'est le corps qui compte, pas
// media.page_id : une image copiée dans une autre page y apparaît, une image
// retirée du corps n'est plus servie.
export async function isMediaPublic(filename: string): Promise<boolean> {
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        isNull(pages.trashedAt),
        // Cité dans le corps, ou icône de la page (lib/icons.ts).
        or(sql`strpos(${pages.body}::text, ${filename}) > 0`, eq(pages.icon, imageIcon(filename))),
      ),
    );
  if (!rows.length) return false;
  const nodes = await withAncestors(rows.map((row) => row.id));
  return rows.some((row) => publicChain(nodes, row.id, (node) => node.publicId !== null) !== null);
}

// Publier tire un identifiant neuf ; republier après une dépublication en
// tire un autre, l'ancien lien restant mort (choix d'Antonin du 2026-10-30).
// Une page déjà publiée garde le sien. updated_at inchangé : publier n'est
// pas modifier.
export async function publishPage(page: Page): Promise<string> {
  if (page.shareEnabled && page.publicId) return page.publicId;
  const publicId = newToken();
  await db
    .update(pages)
    .set({ shareEnabled: true, publicId, updatedAt: sql`${pages.updatedAt}` })
    .where(eq(pages.id, page.id));
  return publicId;
}

export async function unpublishPage(page: Page): Promise<void> {
  await db
    .update(pages)
    .set({ shareEnabled: false, publicId: null, updatedAt: sql`${pages.updatedAt}` })
    .where(eq(pages.id, page.id));
}
