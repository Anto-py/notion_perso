// Déménagement des bases existantes dans « Bases » (étape 16, palier c), sur
// la base vive. Joué au démarrage d'une instance sans SYNC_REMOTE_URL (serveur,
// développement) : le Mac reçoit le résultat par la synchronisation ordinaire,
// si bien que deux instances ne réécrivent jamais les mêmes pages en
// concurrence. npm run bases:demenager le joue à blanc sur une base désignée.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { eq, inArray, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pages } from "../db/schema.ts";
import { planBasesMove, type BasesMovePlan, type MoveRow } from "./bases_move.ts";
import { flattenToText } from "./blocks.ts";
import { compareKeys, keysBetween } from "./order_key.ts";

export type BasesMoveRun = { plan: BasesMovePlan; titles: Map<string, string>; written: boolean };

export class BasesMoveError extends Error {}

export async function runBasesMove<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  { write }: { write: boolean },
): Promise<BasesMoveRun> {
  return database.transaction(async (tx) => {
    // Les lignes sans corps d'abord : au démarrage ordinaire, rien n'est hors
    // de « Bases » et aucun corps n'est lu.
    const lite = await tx
      .select({
        id: pages.id,
        type: pages.type,
        parentId: pages.parentId,
        title: pages.title,
        isInbox: pages.isInbox,
        isBasesRoot: pages.isBasesRoot,
        trashedAt: pages.trashedAt,
      })
      .from(pages)
      .where(ne(pages.type, "entry"));
    const root = lite.find((row) => row.isBasesRoot && row.trashedAt === null);
    if (!root) {
      throw new BasesMoveError("Racine des bases absente : la migration 0012 n'est pas appliquée.");
    }
    const rootId = root.id;
    const types = new Map(lite.map((row) => [row.id, row.type]));
    const hostIds = [
      ...new Set(
        lite
          .filter((row) => row.type === "database" && row.parentId && types.get(row.parentId) !== "folder")
          .map((row) => row.parentId!),
      ),
    ];
    const outside = lite.some(
      (row) => row.type === "database" && (!row.parentId || (row.parentId !== rootId && types.get(row.parentId) !== "folder")),
    );
    const titles = new Map(lite.map((row) => [row.id, row.title]));
    if (!outside) return { plan: planBasesMove([], { target: rootId }), titles, written: false };

    // Un hôte peut être une entrée : la requête légère les écarte, celle-ci
    // les reprend avec leur corps.
    const hosts = hostIds.length
      ? await tx
          .select({ id: pages.id, type: pages.type, parentId: pages.parentId, body: pages.body, trashedAt: pages.trashedAt, title: pages.title })
          .from(pages)
          .where(inArray(pages.id, hostIds))
      : [];
    const bodyOf = new Map(hosts.map((row) => [row.id, row.body]));
    for (const host of hosts) titles.set(host.id, host.title);
    const rows: MoveRow[] = [
      ...lite.map((row) => ({
        id: row.id,
        type: row.type,
        parentId: row.parentId,
        body: bodyOf.get(row.id) ?? [],
        trashed: row.trashedAt !== null,
        title: row.title,
        isInbox: row.isInbox,
      })),
      ...hosts
        .filter((row) => row.type === "entry")
        .map((row) => ({ id: row.id, type: row.type, parentId: row.parentId, body: row.body, trashed: row.trashedAt !== null })),
    ];
    const plan = planBasesMove(rows, { target: rootId });
    if (!write || plan.moved.length === 0) return { plan, titles, written: false };

    // Les bases arrivent après ce que la racine range déjà.
    const siblings = await tx
      .select({ manualOrder: pages.manualOrder })
      .from(pages)
      .where(eq(pages.parentId, rootId));
    const last = siblings.map((row) => row.manualOrder).sort(compareKeys).at(-1) ?? null;
    const keys = keysBetween(last, null, plan.moved.length);
    for (const [index, base] of plan.moved.entries()) {
      await tx
        .update(pages)
        .set({ parentId: plan.target, manualOrder: keys[index], updatedAt: sql`now()` })
        .where(eq(pages.id, base.id));
    }
    for (const [id, body] of plan.bodies) {
      await tx
        .update(pages)
        .set({ body, bodyText: flattenToText(body), updatedAt: sql`now()` })
        .where(eq(pages.id, id));
    }
    return { plan, titles, written: true };
  });
}

// Une ligne de journal par passage, lue dans les journaux du conteneur au
// déploiement (palier d).
export function describeRun({ plan, written }: BasesMoveRun): string {
  const { moved, trashed, converted, added } = plan.report;
  if (moved + trashed === 0) return "Bases : rien à déménager.";
  const verb = written ? "rangées" : "à ranger";
  return `Bases : ${moved + trashed} bases ${verb} sous « Bases de données » (dont ${trashed} en corbeille), ${converted} blocs convertis en vue liée, ${added} vues liées ajoutées en fin de page.`;
}

// Détail base par base, pour l'essai à blanc.
export function describeBases({ plan, titles }: BasesMoveRun): string[] {
  return plan.moved.map((base) => {
    const host = base.hostId ? ` (depuis « ${titles.get(base.hostId) || "Sans titre"} »)` : "";
    const trashed = base.trashed ? ", en corbeille" : "";
    let action: string;
    if (base.action === "converted") action = "bloc converti en vue liée";
    else if (base.action === "added") action = "vue liée ajoutée en fin de page";
    else if (!base.hostId) action = "aucune page hôte";
    else if (base.trashed) action = "page laissée telle quelle";
    else action = "la page la montre déjà par une vue liée";
    return `- ${base.title || "Sans titre"}${host}${trashed} : ${action}`;
  });
}
