// Bases en liens dans « Bases de données », sur la base vive (choix d'Antonin
// du 2026-11-11). Module serveur : lit la page racine et les bases, demande le
// plan pur (bases_links.ts) et l'écrit en une transaction, avec le marqueur
// `conversion.bases_liens` de la table settings. Le marqueur rend la conversion
// unique : une vue liée posée plus tard exprès dans la page n'est plus touchée.
// Appelé au démarrage du serveur et par le script `bases_links.mts`.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pages, settings } from "../db/schema.ts";
import { describeLinksPlan, planBasesLinks, type LinksPlan } from "./bases_links.ts";

// Clé hors de settings_rules : aucune section ne l'affiche, rien ne la
// synchronise, seul ce module la lit.
export const BASES_LINKS_MARK = "conversion.bases_liens";

export type LinksRun = { rootId: string | null; plan: LinksPlan | null; written: boolean };

export async function basesLinksDone<T extends Record<string, unknown>>(database: NodePgDatabase<T>): Promise<boolean> {
  const [row] = await database.select({ key: settings.key }).from(settings).where(eq(settings.key, BASES_LINKS_MARK)).limit(1);
  return row !== undefined;
}

export async function runBasesLinks<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  { write }: { write: boolean },
): Promise<LinksRun> {
  return database.transaction(async (tx) => {
    const [root] = await tx
      .select({ id: pages.id, body: pages.body })
      .from(pages)
      .where(and(eq(pages.isBasesRoot, true), eq(pages.type, "page"), isNull(pages.trashedAt)))
      .for("update");
    // Pas encore de page racine (conversion de l'étape 17 à venir) : rien à
    // faire, et pas de marqueur, pour que le prochain démarrage réessaie.
    if (!root) return { rootId: null, plan: null, written: false };
    const bases = await tx
      .select({ id: pages.id, parentId: pages.parentId, trashedAt: pages.trashedAt })
      .from(pages)
      .where(eq(pages.type, "database"));
    const plan = planBasesLinks(
      root.body,
      root.id,
      bases.map((row) => ({ id: row.id, parentId: row.parentId, trashed: row.trashedAt !== null })),
    );
    if (!write) return { rootId: root.id, plan, written: false };
    const now = new Date();
    if (plan.changed) {
      await tx.update(pages).set({ body: plan.body, bodyText: plan.bodyText, updatedAt: now }).where(eq(pages.id, root.id));
    }
    await tx
      .insert(settings)
      .values({ key: BASES_LINKS_MARK, value: { at: now.toISOString(), owners: plan.owners, links: plan.links } })
      .onConflictDoNothing();
    return { rootId: root.id, plan, written: true };
  });
}

export function describeLinksRun({ rootId, plan, written }: LinksRun): string {
  if (!rootId || !plan) return "Bases en liens : aucune page « Bases de données », rien à faire.";
  return `Bases en liens${written ? "" : " (à blanc)"} : ${describeLinksPlan(plan)}`;
}
