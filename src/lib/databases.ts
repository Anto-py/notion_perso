// Bases et entrées : schéma des propriétés, vue, valeurs, ordre manuel. Les
// règles (validation, conversion, texte de recherche) sont dans
// properties.ts ; ce module les applique en base. Comme pages.ts, il ne
// décide d'aucun droit : chaque route passe d'abord par canAccess.
//
// Verrous : toute écriture qui dépend de la configuration verrouille d'abord
// la ligne de la base, et elle seule. Un ordre de verrouillage unique évite
// les interblocages entre une migration du schéma et une saisie de valeur.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { appendOrphans, flattenToText } from "./blocks";
import { newId } from "./ids";
import { isOrderKey, keyBetween, rekey } from "./order_key";
import type { Outcome, Page } from "./pages";
import { mergeDbConfig, sameJson } from "./sync_merge";
import {
  asValues,
  checkValue,
  isTwin,
  migrateValues,
  normalizeValue,
  normalizeValues,
  orphanValues,
  transferValues,
  valuesToText,
  type EntryRow,
  type LinkRef,
  type Property,
  type Values,
} from "./properties";
import { mergeTwins } from "./relation";
import { fillTwins, writeTwin } from "./relation_query";
import { parseConfig, sanitizeViews, type DbConfig } from "./views";

const NOT_FOUND: Outcome = { ok: false, status: 404, error: "Base introuvable" };
const STALE: Outcome = { ok: false, status: 409, error: "La base a changé : rechargez la page." };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function configOf(page: Pick<Page, "dbConfig">): DbConfig {
  return parseConfig(page.dbConfig);
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

// Même verrou, corbeille comprise : une jumelle se lit et se retire encore
// quand la base qui la porte ou la déclare est en corbeille. La corbeille se
// constate ici plutôt que par un 404.
async function lockConfig(tx: Tx, id: string): Promise<{ config: DbConfig; trashed: boolean } | null> {
  const [row] = await tx
    .select({ dbConfig: pages.dbConfig, trashedAt: pages.trashedAt })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.type, "database")))
    .for("update");
  return row ? { config: parseConfig(row.dbConfig), trashed: row.trashedAt !== null } : null;
}

// Les bases que le schéma d'une base peut toucher : les cibles de ses
// relations et les bases de ses jumelles, puis les mêmes un saut plus loin
// (retirer une jumelle retire la réciprocité, qui peut avoir sa propre
// jumelle ailleurs). Lecture sans verrou, pour connaître l'ordre de
// verrouillage avant de le prendre.
async function linkedDatabases(tx: Pick<Tx, "select">, id: string, patch: DatabasePatch): Promise<string[]> {
  const linked = new Set<string>([id]);
  const seen = new Set<string>([id]);
  // Le schéma d'avant comme celui d'après : une cible qu'on quitte doit être
  // verrouillée, pour y retirer la jumelle qui la citait.
  const before = await readProperties(tx, id);
  const sources: Property[][] = patch.properties ? [before, patch.properties] : [before];
  for (let hop = 0; hop < 2; hop++) {
    for (const properties of sources) {
      for (const prop of properties) {
        if (prop.type !== "relation") continue;
        if (prop.target) linked.add(prop.target);
        if (prop.twinOf) linked.add(prop.twinOf.db);
      }
    }
    sources.length = 0;
    for (const dbId of linked) {
      if (seen.has(dbId)) continue;
      seen.add(dbId);
      sources.push(await readProperties(tx, dbId));
    }
  }
  return [...linked].sort();
}

async function readProperties(tx: Pick<Tx, "select">, id: string): Promise<Property[]> {
  const [row] = await tx
    .select({ dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.type, "database")));
  return row ? parseConfig(row.dbConfig).properties : [];
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

// Les ids cités par une relation doivent exister, être des entrées de la base
// cible et n'être ni en corbeille ni purgées. checkValue, pur, ne peut pas le
// savoir : ce contrôle lit la base dans la transaction de l'écriture.
async function checkRelationTargets(
  tx: Pick<Tx, "select">,
  properties: readonly Property[],
  raw: Record<string, unknown>,
): Promise<string | null> {
  for (const prop of properties) {
    if (prop.type !== "relation") continue;
    const ids = normalizeValue(prop, raw[prop.id]);
    if (!Array.isArray(ids) || ids.length === 0) continue;
    const rows = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          inArray(pages.id, ids),
          eq(pages.type, "entry"),
          eq(pages.dbId, prop.target ?? ""),
          isNull(pages.trashedAt),
        ),
      );
    const known = new Set(rows.map((row) => row.id));
    if (ids.some((id) => !known.has(id))) return `${prop.name} : entrée liée introuvable, rechargez la page.`;
  }
  return null;
}

// Ids cités par les relations d'une entrée, par propriété.
function relationIds(properties: readonly Property[], values: Values): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const prop of properties) {
    if (prop.type !== "relation") continue;
    const ids = normalizeValue(prop, values[prop.id]);
    if (Array.isArray(ids) && ids.length > 0) found.set(prop.id, ids);
  }
  return found;
}

// Titre, icône, corbeille et base publique des entrées citées, en une
// requête. Un id purgé n'a plus de ligne et sa puce disparaît ; un id en
// corbeille est rendu avec trashed, à l'affichage de décider.
async function resolveRefs(ids: Iterable<string>, executor: Pick<typeof db, "select">): Promise<Map<string, LinkRef>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const bases = alias(pages, "bases");
  const rows = await executor
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      trashedAt: pages.trashedAt,
      publicId: bases.publicId,
      shareEnabled: bases.shareEnabled,
    })
    .from(pages)
    .leftJoin(bases, eq(bases.id, pages.dbId))
    .where(inArray(pages.id, wanted));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        icon: row.icon,
        trashed: row.trashedAt !== null,
        publicBaseId: row.shareEnabled ? row.publicId : null,
      } satisfies LinkRef,
    ]),
  );
}

// Les puces d'une entrée seule (page d'une entrée, vue publique).
export async function linksForValues(
  properties: readonly Property[],
  values: Values,
  executor: Pick<typeof db, "select"> = db,
): Promise<Record<string, LinkRef[]>> {
  const perProp = relationIds(properties, values);
  if (perProp.size === 0) return {};
  const refs = await resolveRefs([...perProp.values()].flat(), executor);
  return linksFrom(perProp, refs);
}

function linksFrom(perProp: Map<string, string[]>, refs: Map<string, LinkRef>): Record<string, LinkRef[]> {
  const links: Record<string, LinkRef[]> = {};
  for (const [propId, ids] of perProp) {
    const list = ids.flatMap((id) => {
      const ref = refs.get(id);
      return ref ? [ref] : [];
    });
    if (list.length > 0) links[propId] = list;
  }
  return links;
}

// Les puces de toute une liste d'entrées, en une requête (base vive, vue
// publique, écran d'une sauvegarde).
export async function attachLinks<T extends { values: Values }>(
  properties: readonly Property[],
  entries: T[],
  executor: Pick<typeof db, "select"> = db,
): Promise<(T & { links?: Record<string, LinkRef[]> })[]> {
  const perEntry = entries.map((entry) => relationIds(properties, entry.values));
  if (perEntry.every((perProp) => perProp.size === 0)) return entries;
  const refs = await resolveRefs(perEntry.flatMap((perProp) => [...perProp.values()].flat()), executor);
  return entries.map((entry, index) => {
    const links = perEntry[index].size > 0 ? linksFrom(perEntry[index], refs) : undefined;
    return links ? { ...entry, links } : entry;
  });
}

// Entrées d'une base, hors corbeille, dans l'ordre manuel. executor : la base
// vive par défaut, la copie d'une sauvegarde quand l'écran de sauvegarde lit.
export async function listEntries(dbId: string, executor: Pick<typeof db, "select" | "execute"> = db): Promise<EntryRow[]> {
  const [base] = await executor
    .select({ dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.id, dbId), eq(pages.type, "database")));
  const properties = parseConfig(base?.dbConfig).properties;
  const rows = await executor
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      cover: pages.cover,
      // Première image du corps, colonnes comprises, sans charger le corps
      // entier pour la Galerie (BRAINSTORMING §4, SPECS « views »).
      bodyImage: sql<string | null>`jsonb_path_query_first(${pages.body}, '$.** ? (@.type == "image").props.url') #>> '{}'`,
      propertyValues: pages.propertyValues,
      manualOrder: pages.manualOrder,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(eq(pages.dbId, dbId), eq(pages.type, "entry"), isNull(pages.trashedAt)))
    .orderBy(asc(pages.manualOrder), asc(pages.createdAt));
  const entries = rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    values: asValues(row.propertyValues),
    manualOrder: row.manualOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cover: row.cover,
    bodyImage: row.bodyImage,
  }));
  // Les jumelles remplissent leurs valeurs avant la résolution des puces :
  // elles se lisent dans l'autre base, jamais dans property_values.
  return attachLinks(properties, await fillTwins(properties, entries, executor), executor);
}

// base : les listes que le navigateur avait avant sa modification (lib/web_save.ts).
// Si celles du serveur ont bougé depuis, les deux versions se fusionnent,
// propriété par id et vue par id, la modification qui arrive l'emportant.
export type DatabasePatch = { properties?: Property[]; views?: unknown; base?: { properties?: unknown; views?: unknown } };

// Écrit un schéma dans une base et migre ses valeurs : une propriété retirée
// emporte ses valeurs, un type changé les convertit (properties.ts). Sert à
// la base éditée comme aux bases voisines, quand retirer une jumelle retire la
// relation qui la déclare ailleurs.
async function writeConfig(tx: Tx, dbId: string, before: DbConfig, properties: Property[], views: unknown): Promise<DbConfig> {
  const config: DbConfig = { properties, views: sanitizeViews(views, properties) };
  const entries = await tx
    .select({ id: pages.id, propertyValues: pages.propertyValues, valuesText: pages.valuesText })
    .from(pages)
    .where(eq(pages.dbId, dbId));
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
  await tx.update(pages).set({ dbConfig: config }).where(eq(pages.id, dbId));
  return config;
}

// Nouvelles propriétés (liste complète, déjà validée) et/ou nouvelles vues
// (liste complète, relue contre les propriétés du moment : un filtre ou un
// calcul qui visait une propriété supprimée disparaît de toutes les vues). Un
// changement de propriétés migre les valeurs de toutes les entrées, corbeille
// comprise : une entrée restaurée doit suivre le schéma du moment.
export async function updateDatabase(id: string, patch: DatabasePatch): Promise<Outcome & { config?: DbConfig; merged?: boolean }> {
  return db.transaction(async (tx) => {
    // Toutes les bases que cette écriture peut toucher sont verrouillées
    // d'abord, dans l'ordre de leurs ids : deux bases qui se déclarent une
    // relation réciproque ne peuvent pas s'interbloquer.
    const locked = new Map<string, { config: DbConfig; trashed: boolean }>();
    for (const dbId of await linkedDatabases(tx, id, patch)) {
      const row = await lockConfig(tx, dbId);
      if (row) locked.set(dbId, row);
      if (dbId === id && (!row || row.trashed)) return NOT_FOUND;
    }
    const before = locked.get(id)!.config;

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

    // Une relation nouvelle ou dont la cible change doit désigner une base qui
    // existe et qui n'est pas en corbeille ; une cible déjà acceptée n'est pas
    // revérifiée, pour qu'une base mise en corbeille ailleurs ne bloque pas
    // toute retouche du schéma (BRAINSTORMING §13, l'en-tête avertit).
    if (patch.properties) {
      for (const prop of properties) {
        if (prop.type !== "relation") continue;
        const previous = before.properties.find((item) => item.id === prop.id);
        if (previous?.type === "relation" && previous.target === prop.target) continue;
        const [target] = await tx
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.id, prop.target ?? ""), eq(pages.type, "database"), isNull(pages.trashedAt)));
        if (!target) return { ok: false, status: 400, error: `${prop.name} : la base cible est introuvable` } as const;
      }
    }

    const amended = new Map<string, Property[]>();
    if (patch.properties) {
      // Une jumelle ne survit pas à la disparition de la relation qui la
      // déclare. Une base déclarante absente ou en corbeille ne se juge pas :
      // ses puces restent lisibles jusqu'à sa restauration.
      properties = properties.filter((prop) => {
        if (!prop.twinOf) return true;
        const declaring = prop.twinOf.db === id ? properties : locked.get(prop.twinOf.db)?.config.properties;
        if (!declaring) return true;
        const source = declaring.find((item) => item.id === prop.twinOf!.prop);
        return !!source && source.type === "relation" && source.reciprocal === true && source.target === id;
      });

      // Supprimer une jumelle retire la relation qui la déclare, où qu'elle
      // vive (BRAINSTORMING §13) ; ses valeurs partent avec elle.
      for (const twin of before.properties) {
        if (!twin.twinOf || properties.some((prop) => prop.id === twin.id)) continue;
        const declDb = twin.twinOf.db;
        const source = declDb === id ? properties : locked.get(declDb)?.config.properties;
        if (!source) continue;
        const next = source.filter((prop) => prop.id !== twin.twinOf!.prop);
        if (declDb === id) properties = next;
        else amended.set(declDb, next);
      }
      for (const [declDb, next] of amended) properties = mergeTwins(properties, declDb, next);
    }

    // Les jumelles des relations réciproques de cette base se recalculent dans
    // chaque base cible, y compris dans la base elle-même pour une relation
    // vers soi.
    // Les cibles d'avant comme d'après : une relation devenue non réciproque,
    // retirée ou repointée doit voir sa jumelle recalculée là où elle était.
    const targets = new Set<string>();
    if (patch.properties) {
      for (const prop of [...properties, ...before.properties]) {
        if (prop.type === "relation" && prop.reciprocal === true && prop.target) targets.add(prop.target);
      }
      if (targets.has(id)) {
        properties = mergeTwins(properties, id, properties);
        views = sanitizeViews(views, properties);
      }
    }
    const config: DbConfig = patch.properties
      ? await writeConfig(tx, id, before, properties, views)
      : { properties, views: sanitizeViews(views, properties) };
    if (!patch.properties) await tx.update(pages).set({ dbConfig: config }).where(eq(pages.id, id));

    // Les autres bases : d'abord la relation retirée avec sa jumelle, puis les
    // jumelles de cette base recalculées sur l'état amendé, pour qu'une chaîne
    // de trois bases ne s'écrase pas elle-même. Seule une base qui perd une
    // propriété migre ses valeurs ; une jumelle n'en porte aucune.
    if (patch.properties) {
      const work = new Map<string, { properties: Property[]; migrate: boolean }>();
      const put = (dbId: string, props: Property[], migrate: boolean) => {
        const current = work.get(dbId);
        work.set(dbId, { properties: props, migrate: migrate || (current?.migrate ?? false) });
      };
      for (const [declDb, next] of amended) put(declDb, next, true);
      const currentOf = (dbId: string) => work.get(dbId)?.properties ?? locked.get(dbId)?.config.properties;
      // Une base amendée peut avoir ses propres cibles : sa jumelle doit y
      // suivre la relation qu'elle vient de perdre.
      for (const [declDb, next] of amended) {
        for (const prop of next) {
          if (prop.type !== "relation" || !prop.target || prop.target === id || prop.target === declDb) continue;
          const source = currentOf(prop.target);
          if (source) put(prop.target, mergeTwins(source, declDb, next), false);
        }
      }
      for (const targetId of targets) {
        if (targetId === id) continue;
        const source = currentOf(targetId);
        if (source) put(targetId, mergeTwins(source, id, properties), false);
      }
      for (const [dbId, entry] of work) {
        const row = locked.get(dbId);
        if (!row || row.trashed || sameJson(entry.properties, row.config.properties)) continue;
        if (entry.migrate) {
          await writeConfig(tx, dbId, row.config, entry.properties, row.config.views);
        } else {
          await tx
            .update(pages)
            .set({ dbConfig: { ...row.config, properties: entry.properties, views: sanitizeViews(row.config.views, entry.properties) } })
            .where(eq(pages.id, dbId));
        }
      }
    }
    return { ok: true, config, merged };
  });
}

// Nouvelle entrée, en fin d'ordre manuel, avec d'éventuelles valeurs de départ
// (la colonne Kanban où l'on a cliqué « + »).
export async function createEntry(dbId: string, raw: Record<string, unknown>, title?: string): Promise<Outcome & { id?: string }> {
  return db.transaction(async (tx) => {
    const config = await lockDatabase(tx, dbId);
    if (!config) return NOT_FOUND;
    const error = checkValues(config.properties, raw) ?? (await checkRelationTargets(tx, config.properties, raw));
    if (error) return { ok: false, status: 400, error } as const;
    const values = normalizeValues(config.properties, raw);
    const manualOrder = await keyAfterLast(tx, dbId);
    const id = newId("pg");
    await tx.insert(pages).values({
      id,
      type: "entry",
      dbId,
      // Le sélecteur d'une relation crée l'entrée attendue sous le titre tapé.
      title: (title ?? "").trim().slice(0, 500),
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

    // Écrire depuis une jumelle touche aussi la base qui déclare la relation :
    // les deux sont verrouillées dans l'ordre de leurs ids.
    const preview = await readProperties(tx, found.dbId);
    const twins = patch.values ? preview.filter(isTwin).filter((prop) => prop.id in patch.values!) : [];
    const linked = new Set<string>([found.dbId]);
    for (const twin of twins) if (twin.twinOf) linked.add(twin.twinOf.db);
    const configs = new Map<string, DbConfig | null>();
    for (const dbId of [...linked].sort()) configs.set(dbId, await lockDatabase(tx, dbId));
    for (const twin of twins) {
      if (!configs.get(twin.target ?? "")) {
        return { ok: false, status: 409, error: `${twin.name} : la base d'origine est en corbeille.` } as const;
      }
    }
    const config = configs.get(found.dbId);
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
      // Les jumelles ne s'écrivent pas comme des valeurs : leur delta part vers
      // les entrées qui déclarent la relation (plus bas).
      const plain: Record<string, unknown> = { ...patch.values };
      for (const twin of twins) delete plain[twin.id];
      const error = checkValues(config.properties, plain) ?? (await checkRelationTargets(tx, config.properties, plain));
      if (error) return { ok: false, status: 400, error } as const;
      for (const twin of twins) {
        const targetError = await checkRelationTargets(tx, [twin], { [twin.id]: patch.values![twin.id] });
        if (targetError) return { ok: false, status: 400, error: targetError } as const;
      }
      const [entry] = await tx.select({ propertyValues: pages.propertyValues }).from(pages).where(eq(pages.id, id));
      const merged: Record<string, unknown> = { ...asValues(entry?.propertyValues) };
      for (const [key, value] of Object.entries(plain)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      const values = normalizeValues(config.properties, merged);
      await tx
        .update(pages)
        .set({ propertyValues: values, valuesText: valuesToText(config.properties, values) })
        .where(eq(pages.id, id));
      for (const twin of twins) {
        const wanted = normalizeValue(twin, patch.values![twin.id]);
        await writeTwin(tx, twin, id, Array.isArray(wanted) ? wanted : []);
      }
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
