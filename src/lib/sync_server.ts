// Synchronisation avec l'app Mac, côté serveur (SPECS.md, « Synchronisation
// avec l'app Mac ») : jeton, versions, lecture des changements par lots.
// L'application d'un envoi vit dans sync_push.ts, les décisions dans
// sync_protocol.ts (pur).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import journal from "@/db/migrations/meta/_journal.json";
import { iconImages, media, pages, syncClients } from "@/db/schema";
import { fail } from "./api";
import { hashToken } from "./ids";
import {
  SYNC_BATCH,
  iconImageToSync,
  mediaToSync,
  pageToSync,
  versionGap,
  type Change,
  type SyncKind,
  type SyncVersion,
} from "./sync_protocol";

// --- Accès et versions -------------------------------------------------------

// Le journal des migrations est lu au build : la version annoncée est celle
// du code qui tourne. SOURCE_COMMIT, quand le build le reçoit.
export function serverVersion(): SyncVersion {
  return { schema: journal.entries.at(-1)?.when ?? 0, commit: process.env.SOURCE_COMMIT || null };
}

export type SyncClient = { id: string; name: string };

// Jeton en `Authorization: Bearer …`. Chaque appel reconnu date le passage du
// client, d'où « Mac synchronisé à … » sur l'app web.
async function authenticate(request: Request): Promise<SyncClient | null> {
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const [client] = await db
    .update(syncClients)
    .set({ lastSeenAt: new Date() })
    .where(eq(syncClients.tokenHash, hashToken(match[1])))
    .returning({ id: syncClients.id, name: syncClients.name });
  return client ?? null;
}

// Garde de chaque route de synchronisation. checkVersion faux : seule la
// route qui annonce la version s'en passe, le Mac la lisant pour se mettre à jour.
export async function requireSyncClient(request: Request, checkVersion = true): Promise<SyncClient | Response> {
  const client = await authenticate(request);
  if (!client) return fail(401, "Jeton de synchronisation absent ou révoqué");
  if (!checkVersion) return client;
  const version = serverVersion();
  const gap = versionGap(version, {
    schema: request.headers.get("x-sync-schema"),
    commit: request.headers.get("x-sync-commit"),
  });
  return gap ? Response.json({ error: gap, version }, { status: 409 }) : client;
}

// --- Lecture des changements -------------------------------------------------

// Totaux d'une synchronisation depuis zéro, pour la progression du premier
// lancement (« 640 pages sur 1668, médias 80 Mo sur 257 »).
export type SyncTotals = { pages: number; mediaBytes: number };
export type ChangesBatch = { changes: Change[]; xmin: string; more: boolean; totals: SyncTotals | null };

// Lignes et suppressions de sync_xid >= cursor et rev > after, dans l'ordre
// des révisions. Une transaction en lecture répétable : la liste, les lignes
// et le xmin viennent du même instantané. Le client garde le xmin du premier
// lot d'un cycle et le renvoie comme curseur au cycle suivant.
export async function readChanges(cursor: string, after: number): Promise<ChangesBatch> {
  return db.transaction(
    async (tx) => {
      // Première instruction : c'est elle qui fixe l'instantané.
      const snap = await tx.execute<{ xmin: string }>(sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`);
      const since = sql`sync_xid >= ${cursor}::xid8 AND rev > ${after}`;
      const listed = await tx.execute<{ kind: SyncKind; id: string; rev: string; deleted: boolean }>(sql`
        SELECT 'page' AS kind, id, rev, false AS deleted FROM pages WHERE ${since}
        UNION ALL SELECT 'media', id, rev, false FROM media WHERE ${since}
        UNION ALL SELECT 'icon_image', id, rev, false FROM icon_images WHERE ${since}
        UNION ALL SELECT kind, id, rev, true FROM deletions WHERE ${since}
        ORDER BY rev LIMIT ${SYNC_BATCH + 1}`);
      const rows = listed.rows.slice(0, SYNC_BATCH);
      const wanted = (kind: SyncKind) => rows.filter((row) => !row.deleted && row.kind === kind).map((row) => row.id);

      const found = new Map<string, Change>();
      const pageIds = wanted("page");
      for (const row of pageIds.length ? await tx.select().from(pages).where(inArray(pages.id, pageIds)) : []) {
        found.set(`page:${row.id}`, { kind: "page", id: row.id, rev: row.rev, row: pageToSync(row) });
      }
      const mediaIds = wanted("media");
      for (const row of mediaIds.length ? await tx.select().from(media).where(inArray(media.id, mediaIds)) : []) {
        found.set(`media:${row.id}`, { kind: "media", id: row.id, rev: row.rev, row: mediaToSync(row) });
      }
      const iconIds = wanted("icon_image");
      for (const row of iconIds.length ? await tx.select().from(iconImages).where(inArray(iconImages.id, iconIds)) : []) {
        found.set(`icon_image:${row.id}`, { kind: "icon_image", id: row.id, rev: row.rev, row: iconImageToSync(row) });
      }

      const changes = rows.map(
        (row): Change => found.get(`${row.kind}:${row.id}`) ?? { kind: row.kind, id: row.id, rev: Number(row.rev), deleted: true },
      );
      // Premier lot d'une synchronisation depuis zéro : le client ne peut pas
      // connaître le total, seul le serveur le sait.
      let totals: SyncTotals | null = null;
      if (cursor === "0" && after === 0) {
        const counted = await tx.execute<{ pages: string; media_bytes: string }>(sql`
          SELECT (SELECT count(*) FROM pages)::text AS pages,
                 (SELECT coalesce(sum(size), 0) FROM media)::text AS media_bytes`);
        totals = {
          pages: Number(counted.rows[0]?.pages ?? 0),
          mediaBytes: Number(counted.rows[0]?.media_bytes ?? 0),
        };
      }
      return { changes, xmin: snap.rows[0].xmin, more: listed.rows.length > SYNC_BATCH, totals };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// Curseur confirmé par le client au début d'un cycle : il ne l'envoie
// qu'après une lecture complète. Indicatif côté serveur, jamais en recul.
export async function confirmCursor(clientId: string, cursor: string): Promise<void> {
  await db
    .update(syncClients)
    .set({ cursor: sql`${cursor}::xid8` })
    .where(and(eq(syncClients.id, clientId), sql`${syncClients.cursor} < ${cursor}::xid8`));
}
