// Bases et entrées : schéma des propriétés, vue, valeurs, ordre manuel. Les
// règles (validation, conversion, texte de recherche) sont dans
// properties.ts ; ce module les applique en base. Comme pages.ts, il ne
// décide d'aucun droit : chaque route passe d'abord par canAccess.
//
// Verrous : toute écriture qui dépend de la configuration verrouille d'abord
// la ligne de la base, et elle seule. Un ordre de verrouillage unique évite
// les interblocages entre une migration du schéma et une saisie de valeur.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { appendOrphans, flattenToText } from "./blocks";
import { newId } from "./ids";
import { isOrderKey, keyBetween, rekey } from "./order_key";
import type { Outcome, Page } from "./pages";
import { mergeDbConfig, sameJson } from "./sync_merge";
import {
  checkValue,
  migrateValues,
  normalizeValues,
  orphanValues,
  transferValues,
  valuesToText,
  type EntryRow,
  type Property,
  type Values,
} from "./properties";
import { parseConfig, sanitizeViews, type DbConfig } from "./views";

const NOT_FOUND: Outcome = { ok: false, status: 404, error: "Base introuvable" };
const STALE: Outcome = { ok: false, status: 409, error: "La base a changé : rechargez la page." };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function configOf(page: Pick<Page, "dbConfig">): DbConfig {
  return parseConfig(page.dbConfig);
}

function asValues(raw: unknown): Values {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Values) : {};
}

function sameValues(a: Values, b: Values): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

// Clé qui place une entrée après toutes celles de la base, corbeille comprise.
export async function keyAfterLast(tx: Pick<Tx, "select">, dbId: string): Promise<string> {
  const [{ last }] = await tx
    .select({ last: sql<string | null>`max(${pages.manualOrder})` })
    .from(pages)
    .where(eq(pages.dbId, dbId));
  return keyBetween(isOrderKey(last) ? last : null, null);
}

async function lockDatabase(tx: Tx, id: string): Promise<DbConfig | null> {
  const [base] = await tx
    .select({ dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.type, "database"), isNull(pages.trashedAt)))
    .for("update");
  return base ? parseConfig(base.dbConfig) : null;
}

// Clés inconnues ou valeurs irrecevables : refus lisible, rien n'est écrit.
function checkValues(properties: readonly Property[], raw: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(raw)) {
    const prop = properties.find((p) => p.id === key);
    if (!prop) return "Propriété inconnue : rechargez la page.";
    const error = checkValue(prop, value);
    if (error) return error;
  }
  return null;
}

// Entrées d'une base, hors corbeille, dans l'ordre manuel. executor : la base
// vive par défaut, la copie d'une sauvegarde quand l'écran de sauvegarde lit.
export async function listEntries(dbId: string, executor: Pick<typeof db, "select"> = db): Promise<EntryRow[]> {
  const rows = await executor
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      propertyValues: pages.propertyValues,
      manualOrder: pages.manualOrder,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(eq(pages.dbId, dbId), eq(pages.type, "entry"), isNull(pages.trashedAt)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    values: asValues(row.propertyValues),
    manualOrder: row.manualOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// base : les listes que le navigateur avait avant sa modification (lib/web_save.ts).
// Si celles du serveur ont bougé depuis, les deux versions se fusionnent,
// propriété par id et vue par id, la modification qui arrive l'emportant.
export type DatabasePatch = { properties?: Property[]; views?: unknown; base?: { properties?: unknown; views?: unknown } };

// Nouvelles propriétés (liste complète, déjà validée) et/ou nouvelles vues
// (liste complète, relue contre les propriétés du moment : un filtre ou un
// calcul qui visait une propriété supprimée disparaît de toutes les vues). Un
// changement de propriétés migre les valeurs de toutes les entrées, corbeille
// comprise : une entrée restaurée doit suivre le schéma du moment.
export async function updateDatabase(id: string, patch: DatabasePatch): Promise<Outcome & { config?: DbConfig; merged?: boolean }> {
  return db.transaction(async (tx) => {
    const before = await lockDatabase(tx, id);
    if (!before) return NOT_FOUND;
    let properties = patch.properties ?? before.properties;
    let views = patch.views ?? before.views;
    const base = patch.base;
    const moved = (key: "properties" | "views") => base !== undefined && key in base && patch[key] !== undefined && !sameJson(base[key], before[key]);
    const merged = moved("properties") || moved("views");
    if (merged) {
      const common = { properties: base?.properties ?? before.properties, views: base?.views ?? before.views };
      const config = parseConfig(mergeDbConfig(common, { properties, views }, before, true));
      properties = config.properties;
      views = config.views;
    }
    const config: DbConfig = { properties, views: sanitizeViews(views, properties) };

    if (patch.properties) {
      const entries = await tx
        .select({ id: pages.id, propertyValues: pages.propertyValues, valuesText: pages.valuesText })
        .from(pages)
        .where(eq(pages.dbId, id));
      for (const entry of entries) {
        const current = asValues(entry.propertyValues);
        const values = migrateValues(before.properties, properties, current);
        const text = valuesToText(properties, values);
        if (text === entry.valuesText && sameValues(values, current)) continue;
        // updated_at inchangé : c'est la base qui a changé, pas l'entrée.
        await tx
          .update(pages)
          .set({ propertyValues: values, valuesText: text, updatedAt: sql`${pages.updatedAt}` })
          .where(eq(pages.id, entry.id));
      }
    }

    await tx.update(pages).set({ dbConfig: config }).where(eq(pages.id, id));
    return { ok: true, config, merged };
  });
}

// Nouvelle entrée, en fin d'ordre manuel, avec d'éventuelles valeurs de départ
// (la colonne Kanban où l'on a cliqué « + »).
export async function createEntry(dbId: string, raw: Record<string, unknown>): Promise<Outcome & { id?: string }> {
  return db.transaction(async (tx) => {
    const config = await lockDatabase(tx, dbId);
    if (!config) return NOT_FOUND;
    const error = checkValues(config.properties, raw);
    if (error) return { ok: false, status: 400, error } as const;
    const values = normalizeValues(config.properties, raw);
    const manualOrder = await keyAfterLast(tx, dbId);
    const id = newId("pg");
    await tx.insert(pages).values({
      id,
      type: "entry",
      dbId,
      propertyValues: values,
      valuesText: valuesToText(config.properties, values),
      manualOrder,
    });
    return { ok: true, id } as const;
  });
}

// Déplacement d'une entrée vers une autre base. Les valeurs suivent quand la
// propriété de destination porte le même nom et le même type (transferValues,
// pur) ; les autres sont laissées. Les deux bases sont verrouillées dans
// l'ordre de leurs ids, pour qu'un déplacement croisé ne s'interbloque pas.
export async function moveEntry(id: string, targetDbId: string): Promise<Outcome & { id?: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ dbId: pages.dbId })
      .from(pages)
      .where(and(eq(pages.id, id), eq(pages.type, "entry"), isNull(pages.trashedAt)));
    if (!entry?.dbId) return { ok: false, status: 404, error: "Entrée introuvable" } as const;
    if (entry.dbId === targetDbId) return { ok: false, status: 400, error: "L'entrée est déjà dans cette base." } as const;

    const [firstId, secondId] = entry.dbId < targetDbId ? [entry.dbId, targetDbId] : [targetDbId, entry.dbId];
    const first = await lockDatabase(tx, firstId);
    const second = await lockDatabase(tx, secondId);
    const source = entry.dbId === firstId ? first : second;
    const target = targetDbId === firstId ? first : second;
    if (!source) return { ok: false, status: 404, error: "Base d'origine introuvable" } as const;
    if (!target) return { ok: false, status: 404, error: "Base de destination introuvable" } as const;

    const [row] = await tx
      .select({ propertyValues: pages.propertyValues, body: pages.body })
      .from(pages)
      .where(eq(pages.id, id));
    const previous = asValues(row?.propertyValues);
    const values = transferValues(source.properties, target.properties, previous);
    const manualOrder = await keyAfterLast(tx, targetDbId);
    const [targetMeta] = await tx.select({ isInbox: pages.isInbox }).from(pages).where(eq(pages.id, targetDbId));

    const patch: Partial<typeof pages.$inferInsert> = {
      dbId: targetDbId,
      propertyValues: values,
      valuesText: valuesToText(target.properties, values),
      manualOrder,
    };
    // Une valeur sans propriété d'accueil n'est pas jetée : elle rejoint le
    // corps de la page, préfixée de son nom, l'URL restant cliquable.
    const orphans = orphanValues(source.properties, target.properties, previous, values);
    if (orphans.length > 0) {
      const body = appendOrphans(row?.body, orphans);
      patch.body = body;
      patch.bodyText = flattenToText(body);
    }
    // La nature d'une capture (lien ou note) ne suit pas l'entrée dans une
    // base ordinaire.
    if (!targetMeta?.isInbox) patch.inboxKind = null;
    await tx.update(pages).set(patch).where(eq(pages.id, id));
    return { ok: true, id } as const;
  });
}

// values : seules les clés envoyées changent, null efface. order : ids des
// entrées de la base dans le nouvel ordre manuel ; celles qui manquent (créées
// dans un autre onglet) gardent leur rang relatif, à la suite. Les deux
// partent dans la même transaction : déposer une carte dans une autre colonne
// change sa valeur et sa place d'un seul geste.
export type EntryPatch = { values?: Record<string, unknown>; order?: string[] };

export async function updateEntry(id: string, patch: EntryPatch): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ dbId: pages.dbId })
      .from(pages)
      .where(and(eq(pages.id, id), eq(pages.type, "entry"), isNull(pages.trashedAt)));
    if (!found?.dbId) return { ok: false, status: 404, error: "Entrée introuvable" } as const;
    const config = await lockDatabase(tx, found.dbId);
    if (!config) return NOT_FOUND;

    let order: Map<string, string> | null = null;
    if (patch.order) {
      const rows = await tx
        .select({ id: pages.id, manualOrder: pages.manualOrder })
        .from(pages)
        .where(and(eq(pages.dbId, found.dbId), isNull(pages.trashedAt)))
        .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
      const known = new Set(rows.map((row) => row.id));
      const wanted = [...new Set(patch.order)];
      if (wanted.some((entryId) => !known.has(entryId))) return STALE;
      const listed = new Set(wanted);
      const ids = [...wanted, ...rows.map((row) => row.id).filter((entryId) => !listed.has(entryId))];
      order = rekey(ids, new Map(rows.map((row) => [row.id, row.manualOrder])));
    }

    if (patch.values) {
      const error = checkValues(config.properties, patch.values);
      if (error) return { ok: false, status: 400, error } as const;
      const [entry] = await tx.select({ propertyValues: pages.propertyValues }).from(pages).where(eq(pages.id, id));
      const merged: Record<string, unknown> = { ...asValues(entry?.propertyValues) };
      for (const [key, value] of Object.entries(patch.values)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      const values = normalizeValues(config.properties, merged);
      await tx
        .update(pages)
        .set({ propertyValues: values, valuesText: valuesToText(config.properties, values) })
        .where(eq(pages.id, id));
    }

    // Seules les entrées sorties de la plus longue suite déjà ordonnée
    // reçoivent une clé neuve, une seule pour un glisser (lib/order_key.ts).
    // updated_at inchangé : déplacer n'est pas modifier.
    if (order && order.size > 0) {
      const ids = [...order.keys()];
      await tx.execute(sql`
        UPDATE pages SET manual_order = v.key
        FROM unnest(ARRAY[${sql.join(ids.map((entryId) => sql`${entryId}`), sql`, `)}]::text[],
                    ARRAY[${sql.join(ids.map((entryId) => sql`${order.get(entryId)!}`), sql`, `)}]::text[]) AS v(id, key)
        WHERE pages.id = v.id`);
    }
    return { ok: true } as const;
  });
}
