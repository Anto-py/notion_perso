// Vitrine de veille (étape 20), partie serveur : la base active, ses entrées
// publiques, la portée des médias et le pilotage depuis le panneau
// « Partager ». Les règles pures vivent dans vitrine.ts.
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { listEntries } from "./databases";
import { getPage, type Page } from "./pages";
import { syncConfig } from "./sync_config";
import { parseConfig } from "./views";
import {
  assignSlugs,
  toVitrineEntry,
  vitrineFields,
  type VitrineEntry,
} from "./vitrine";
import { applyVitrinePatch, vitrineAddress, type VitrinePatch } from "./vitrine_pilotage";

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

export type Vitrine = {
  base: { id: string; title: string; icon: string | null; cover: string | null; coverPosition: number | null };
  entries: VitrineEntry[];
  welcome: Page | null;
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
  };
});

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
