// Conversion des liens nus des pages ordinaires en mentions (étape 22, palier
// d, choix d'Antonin du 2026-11-14). Module serveur : repère les pages à
// convertir, lit les titres une fois, puis écrit page par page, chacune dans
// sa transaction sous verrou de ligne, en relisant le corps sous ce verrou
// (une page modifiée entre-temps est convertie depuis son état du moment).
// Les entrées et les bases ne sont jamais touchées.
//
// Le marqueur `conversion.mentions` rend la conversion unique : le démarrage la
// joue en tâche de fond, le script `mention_conversion.mts` la joue à blanc ou
// en écriture. Un second passage ne trouve rien : une mention n'est plus un
// lien nu.
//
// Extensions .ts explicites : le script tourne sous Node seul.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pages, settings } from "../db/schema.ts";
import { flattenToText } from "./blocks.ts";
import { mentionHost } from "./mention.ts";
import { bareLinkUrls, countBareLinks, mentionizeBlocks } from "./mention_links.ts";
import { fetchTitles } from "./mention_titles.ts";

// Clé hors de settings_rules : aucune section ne l'affiche, rien ne la
// synchronise, seul ce module la lit.
export const MENTIONS_CONVERSION_MARK = "conversion.mentions";

// Pré-filtre SQL large : un lien http(s) quelque part dans le corps, le schéma
// sans égard à la casse (« HTTPS:// »). Le tri fin (texte égal à l'adresse,
// hors code) revient à `bareLinkUrls`.
const HAS_LINK = 'strict $.** ? (@.type == "link" && @.href like_regex "^https?://" flag "i")';

export type MentionPagePlan = { id: string; links: number; urls: string[] };

export type MentionPlan = {
  pages: MentionPagePlan[];
  links: number;
  urls: string[];
  hosts: string[];
};

export type MentionRun = {
  plan: MentionPlan;
  titles: number;
  converted: number;
  written: boolean;
};

function planOf(rows: readonly { id: string; body: unknown }[]): MentionPlan {
  const planned: MentionPagePlan[] = [];
  const urls = new Set<string>();
  let links = 0;
  for (const row of rows) {
    const found = bareLinkUrls(row.body);
    if (!found.length) continue;
    const count = countBareLinks(row.body);
    planned.push({ id: row.id, links: count, urls: found });
    links += count;
    for (const url of found) urls.add(url);
  }
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = mentionHost(url);
    if (host) hosts.add(host);
  }
  return { pages: planned, links, urls: [...urls], hosts: [...hosts].sort() };
}

export async function mentionsConversionDone<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
): Promise<boolean> {
  const [row] = await database
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, MENTIONS_CONVERSION_MARK))
    .limit(1);
  return row !== undefined;
}

export async function runMentionConversion<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  { write }: { write: boolean },
): Promise<MentionRun> {
  const rows = await database
    .select({ id: pages.id, body: pages.body })
    .from(pages)
    .where(
      and(
        eq(pages.type, "page"),
        isNull(pages.trashedAt),
        sql`jsonb_path_exists(${pages.body}, ${HAS_LINK}::jsonpath)`,
      ),
    )
    .orderBy(pages.id);
  const plan = planOf(rows);
  if (!write) return { plan, titles: 0, converted: 0, written: false };

  // Réseau hors transaction : une lecture par adresse distincte, quatre en vol
  // au plus. Un site muet laisse la mention au domaine.
  const titles = plan.urls.length ? await fetchTitles(plan.urls) : new Map<string, string>();
  const now = new Date();
  let converted = 0;
  for (const page of plan.pages) {
    const done = await database.transaction(async (tx) => {
      const [row] = await tx
        .select({ body: pages.body })
        .from(pages)
        .where(and(eq(pages.id, page.id), eq(pages.type, "page"), isNull(pages.trashedAt)))
        .for("update");
      // Page mise à la corbeille entre-temps, ou vidée de ses liens nus.
      if (!row || countBareLinks(row.body) === 0) return false;
      const next = mentionizeBlocks(row.body, titles);
      await tx
        .update(pages)
        .set({ body: next, bodyText: flattenToText(next), updatedAt: now })
        .where(eq(pages.id, page.id));
      return true;
    });
    if (done) converted++;
  }

  // Posé même quand rien ne restait : « une seule fois » vaut aussi pour une
  // base déjà propre, que le démarrage ne doit pas rebalayer à chaque lancement.
  await database
    .insert(settings)
    .values({
      key: MENTIONS_CONVERSION_MARK,
      value: { at: now.toISOString(), pages: converted, links: plan.links, urls: plan.urls.length },
    })
    .onConflictDoNothing();
  return { plan, titles: titles.size, converted, written: true };
}

export function describeMentionConversion({ plan, titles, converted, written }: MentionRun): string {
  if (!plan.pages.length) return "Mentions de sites : aucun lien nu à convertir.";
  const counts = `${plan.pages.length} page(s), ${plan.links} lien(s), ${plan.urls.length} adresse(s), ${plan.hosts.length} site(s)`;
  if (!written) return `Mentions de sites (à blanc) : ${counts}.`;
  return `Mentions de sites : ${counts}, ${converted} page(s) convertie(s), ${titles} titre(s) lu(s).`;
}
