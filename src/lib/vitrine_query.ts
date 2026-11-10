// Vitrine de veille (étape 20), partie serveur : la base active, ses entrées
// publiques, la portée des médias et le pilotage depuis le panneau
// « Partager ». Les règles pures vivent dans vitrine.ts.
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { renderHtml } from "./blocks";
import { listEntries } from "./databases";
import { getPage, type Page } from "./pages";
import { HIT_END, HIT_START } from "./search";
import { syncConfig } from "./sync_config";
import { parseConfig } from "./views";
import {
  assignSlugs,
  toVitrineEntry,
  vitrineFields,
  vitrineRenderOptions,
  type VitrineEntry,
  type VitrineFields,
} from "./vitrine";
import { logoTarget } from "./vitrine_logo";
import { findFiche } from "./vitrine_state";
import { applyVitrinePatch, vitrineAddress, type VitrinePatch } from "./vitrine_pilotage";
import { rankVitrineHits, vitrineSearchTerms, type FieldRank, type VitrineSearch } from "./vitrine_search";

// Interrupteur booléen vrai seulement, comme parseVitrine : la chaîne "true"
// n'active rien.
const ENABLED = sql`${pages.dbConfig} -> 'vitrine' -> 'enabled' = 'true'::jsonb`;

type Named = { id: string; title: string };

// La base que montre /veille : vivante et activée. Deux bases activées (une
// sur le Mac, une sur le web avant synchronisation) : la plus petite id, pour
// une réponse stable.
async function activeBase(exceptId?: string) {
  const [row] = await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, cover: pages.cover, coverPosition: pages.coverPosition, dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.type, "database"), isNull(pages.trashedAt), ENABLED, exceptId ? ne(pages.id, exceptId) : undefined))
    .orderBy(pages.id)
    .limit(1);
  return row ?? null;
}

// Page d'accueil lisible : vivante, de type page.
function livingWelcome(page: Page | null): Page | null {
  return page && !page.trashedAt && page.type === "page" ? page : null;
}

// `fields` reste au serveur (searchVitrine) : il porte les options des
// propriétés lues, jamais celles de Catégorie.
export type Vitrine = {
  base: { id: string; title: string; icon: string | null; cover: string | null; coverPosition: number | null };
  entries: VitrineEntry[];
  welcome: Page | null;
  fields: VitrineFields;
};

// Ce que sert /veille, lu en direct à chaque rendu (aucun cache entre deux
// visites) ; null sans base active, base en corbeille ou supprimée.
export const loadVitrine = cache(async (): Promise<Vitrine | null> => {
  const row = await activeBase();
  if (!row) return null;
  const config = parseConfig(row.dbConfig);
  const fields = vitrineFields(config.properties);
  const [rows, withNotes, welcomePage] = await Promise.all([
    listEntries(row.id),
    db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.dbId, row.id), eq(pages.type, "entry"), isNull(pages.trashedAt), sql`btrim(${pages.bodyText}) <> ''`)),
    config.vitrine?.welcomePageId ? getPage(config.vitrine.welcomePageId) : Promise.resolve(null),
  ]);
  const notes = new Set(withNotes.map((entry) => entry.id));
  const slugs = assignSlugs(rows);
  const now = Date.now();
  return {
    base: { id: row.id, title: row.title, icon: row.icon, cover: row.cover, coverPosition: row.coverPosition },
    entries: rows.map((entry) => toVitrineEntry(entry, fields, { slug: slugs.get(entry.id)!, hasNotes: notes.has(entry.id), now })),
    welcome: livingWelcome(welcomePage),
    fields,
  };
});

// Notes d'une fiche (§6) : corps de l'entrée rendu comme la vue publique,
// liens réécrits pour la vitrine (une autre entrée mène à sa fiche, toute
// autre page reste privée). `fiche` : slug ou id ; null sans vitrine ou pour
// une entrée inconnue. Lu à l'ouverture, jamais envoyé avec la page.
export async function vitrineSheet(fiche: string): Promise<{ slug: string; html: string } | null> {
  const vitrine = await loadVitrine();
  const entry = vitrine ? findFiche(vitrine.entries, fiche) : null;
  if (!vitrine || !entry) return null;
  const page = await getPage(entry.id);
  if (!page || page.trashedAt) return null;
  return { slug: entry.slug, html: renderHtml(page.body, vitrineRenderOptions(vitrine.entries)).trim() };
}

// Page d'accueil à lire pour le logo d'un hôte (§12), null sans vitrine ou si
// aucune entrée vivante n'a ce site. Ne lit que la valeur Site Web : la route
// du logo est appelée une fois par carte, loadVitrine y serait trop lourd.
export async function vitrineLogoTarget(host: string): Promise<string | null> {
  const row = await activeBase();
  const site = row ? vitrineFields(parseConfig(row.dbConfig).properties).site : null;
  if (!row || !site) return null;
  const rows = await db
    .select({ site: sql<string | null>`${pages.propertyValues} ->> ${site.id}` })
    .from(pages)
    .where(and(eq(pages.dbId, row.id), eq(pages.type, "entry"), isNull(pages.trashedAt)));
  return logoTarget(host, rows.map((entry) => entry.site));
}

// Extrait d'une ligne, marqué comme celui de la recherche de l'app.
const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=18, MinWords=8, MaxFragments=1, FragmentDelimiter=" … "`;

// Recherche de /veille (§2) sur les entrées vivantes de la base active, null
// sans vitrine. Quatre documents par entrée, bâtis à la volée : titre,
// libellés de Domaine (table id → libellé passée en jsonb), Description,
// corps. Un mot est trouvé dans un champ par sa racine française (« reviser »
// trouve « révision ») ou comme début de mot sans accents (« evaluat »
// trouve « évaluation » pendant la frappe, motif de searchPages). Le tri et
// le choix du mode sont dans rankVitrineHits.
export async function searchVitrine(raw: string): Promise<VitrineSearch | null> {
  const vitrine = await loadVitrine();
  if (!vitrine) return null;
  const { query, terms } = vitrineSearchTerms(raw);
  if (!terms.length) return { query, mode: "tous_les_mots", total: 0, results: [] };

  const { domaines, description } = vitrine.fields;
  const labels = Object.fromEntries((domaines?.options ?? []).map((option) => [option.id, option.name]));
  const list = sql.join(
    terms.map((term) => sql`${term}`),
    sql`, `,
  );
  // Mots réduits à lettres et chiffres par searchTerms : aucune syntaxe de
  // tsquery ni d'expression régulière ne peut s'y glisser.
  const combined = terms.map((term) => `${term}:*`).join(" | ");
  const result = await db.execute<{ id: string; title: string; found: number; field: FieldRank; snippet: string | null }>(sql`
    WITH terms AS MATERIALIZED (
      SELECT f_unaccent(t) AS t, to_tsquery('french', f_unaccent(t) || ':*') AS q
      FROM unnest(ARRAY[${list}]::text[]) AS t
    ), labels AS MATERIALIZED (
      SELECT key AS id, value AS label FROM jsonb_each_text(${JSON.stringify(labels)}::jsonb)
    ), docs AS MATERIALIZED (
      SELECT p.id, p.title, COALESCE(p.body_text, '') AS body,
        ARRAY[COALESCE(p.title, ''), dom.text, COALESCE(p.property_values ->> ${description?.id ?? ""}, ''), COALESCE(p.body_text, '')] AS texts
      FROM pages p
      CROSS JOIN LATERAL (
        SELECT COALESCE(string_agg(l.label, ' '), '') AS text
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(p.property_values -> ${domaines?.id ?? ""}) = 'array'
          THEN p.property_values -> ${domaines?.id ?? ""} ELSE '[]'::jsonb END
        ) AS v(id)
        JOIN labels l ON l.id = v.id
      ) dom
      WHERE p.db_id = ${vitrine.base.id} AND p.type = 'entry' AND p.trashed_at IS NULL
    ), fields AS (
      SELECT d.id, f.rank, to_tsvector('french', f_unaccent(f.text)) AS v, lower(f_unaccent(f.text)) AS plain
      FROM docs d
      CROSS JOIN LATERAL unnest(d.texts) WITH ORDINALITY AS f(text, rank)
    ), hits AS (
      SELECT fields.id, terms.t, min(fields.rank) AS rank
      FROM fields
      CROSS JOIN terms
      WHERE fields.v @@ terms.q OR fields.plain ~ ('\\m' || terms.t)
      GROUP BY fields.id, terms.t
    ), scored AS (
      SELECT id, count(*)::int AS found, min(rank)::int AS field FROM hits GROUP BY id
    )
    SELECT d.id, d.title, s.found, s.field,
      CASE WHEN s.field = 4
        THEN ts_headline('fr_unaccent', d.body, to_tsquery('french', f_unaccent(${combined})), ${HEADLINE_OPTIONS})
      END AS snippet
    FROM scored s
    JOIN docs d ON d.id = s.id
  `);
  const slugOf = new Map(vitrine.entries.map((entry) => [entry.id, entry.slug]));
  return { query, ...rankVitrineHits(result.rows, terms.length, slugOf) };
}

// Pages dont les médias se servent sans session au titre de la vitrine : la
// base (icône, bandeau), ses entrées vivantes, la page d'accueil. Réunie à la
// portée des publications par publication_query.ts.
export async function vitrineReach(): Promise<string[]> {
  const row = await activeBase();
  if (!row) return [];
  const entries = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.dbId, row.id), eq(pages.type, "entry"), isNull(pages.trashedAt)));
  const welcomeId = parseConfig(row.dbConfig).vitrine?.welcomePageId;
  const welcome = welcomeId ? livingWelcome(await getPage(welcomeId)) : null;
  return [row.id, ...entries.map((entry) => entry.id), ...(welcome ? [welcome.id] : [])];
}

export type VitrineState = {
  enabled: boolean;
  welcomePageId: string | null;
  welcomeTitle: string | null;
  // Page choisie partie en corbeille ou supprimée : « Page introuvable ».
  welcomeMissing: boolean;
  activeElsewhere: Named | null;
  url: string;
};

// État de la section « Vitrine » du panneau d'une base.
export async function vitrineState(base: Page): Promise<VitrineState> {
  const vitrine = parseConfig(base.dbConfig).vitrine;
  const welcomeId = vitrine?.welcomePageId ?? null;
  const [welcome, other] = await Promise.all([welcomeId ? getPage(welcomeId) : Promise.resolve(null), activeBase(base.id)]);
  const living = livingWelcome(welcome);
  return {
    enabled: vitrine?.enabled ?? false,
    welcomePageId: welcomeId,
    welcomeTitle: living ? living.title : null,
    welcomeMissing: welcomeId !== null && !living,
    activeElsewhere: other ? { id: other.id, title: other.title } : null,
    url: vitrineAddress(syncConfig()?.remote ?? null),
  };
}

export type VitrineRefusal = { ok: false; status: 400 | 404 | 409; error: string };

const quoted = (title: string) => `« ${title || "Sans titre"} »`;

// Pose l'interrupteur et/ou la page d'accueil. Une seule base active : 409
// si une autre, vivante, l'est déjà ; une base en corbeille qui l'était
// s'éteint, pour qu'une restauration ne fasse pas deux vitrines. Seule la clé
// vitrine de db_config est écrite, updated_at inchangé (piloter n'est pas
// modifier), et le déclencheur de synchronisation l'estampille. L'appelant
// efface ensuite la portée des médias (forgetPublicReach).
export async function setVitrine(base: Page, patch: VitrinePatch): Promise<{ ok: true } | VitrineRefusal> {
  if (base.type !== "database") return { ok: false, status: 404, error: "Base introuvable" };
  if (patch.welcomePageId) {
    const welcome = await getPage(patch.welcomePageId);
    if (!welcome || welcome.trashedAt) return { ok: false, status: 400, error: "Page d'accueil introuvable" };
    if (welcome.type !== "page" || welcome.isInbox) {
      return { ok: false, status: 400, error: "La page d'accueil doit être une page (ni base, ni dossier, ni Vide-cerveau)." };
    }
  }
  return db.transaction(async (tx): Promise<{ ok: true } | VitrineRefusal> => {
    // Deux activations simultanées passeraient chacune le contrôle de l'autre.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('notion_perso_vitrine'))`);
    const [row] = await tx
      .select({ dbConfig: pages.dbConfig })
      .from(pages)
      .where(and(eq(pages.id, base.id), eq(pages.type, "database"), isNull(pages.trashedAt)))
      .for("update");
    if (!row) return { ok: false, status: 404, error: "Base introuvable" };
    const next = applyVitrinePatch(parseConfig(row.dbConfig).vitrine, patch);
    if (next.enabled) {
      const [other] = await tx
        .select({ title: pages.title })
        .from(pages)
        .where(and(eq(pages.type, "database"), isNull(pages.trashedAt), ENABLED, ne(pages.id, base.id)))
        .limit(1);
      if (other) return { ok: false, status: 409, error: `La vitrine montre déjà ${quoted(other.title)} : coupez-la d'abord.` };
      await tx
        .update(pages)
        .set({ dbConfig: sql`jsonb_set(${pages.dbConfig}, '{vitrine,enabled}', 'false'::jsonb)`, updatedAt: sql`${pages.updatedAt}` })
        .where(and(eq(pages.type, "database"), sql`${pages.trashedAt} IS NOT NULL`, ENABLED));
    }
    await tx
      .update(pages)
      .set({
        dbConfig: sql`coalesce(${pages.dbConfig}, '{}'::jsonb) || jsonb_build_object('vitrine', ${JSON.stringify(next)}::jsonb)`,
        updatedAt: sql`${pages.updatedAt}`,
      })
      .where(eq(pages.id, base.id));
    return { ok: true };
  });
}
