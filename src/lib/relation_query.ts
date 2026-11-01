// Relations entre bases, la jumelle vue de la base : lecture de ses valeurs et
// écriture depuis elle (étape 10, palier b). Les règles pures sont dans
// relation.ts ; ce module ne fait que les appliquer, dans la transaction et
// sous les verrous posés par databases.ts.
//
// Aucune jumelle ne stocke de valeur : la lecture d'une entrée citée remonte
// les entrées déclarantes qui la citent, et une écriture depuis la jumelle
// répercute le delta sur ces entrées déclarantes.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { asValues, normalizeValue, valuesToText } from "./properties";
import type { Property, RollupCalc, TwinRef, Value, Values } from "./properties";
import { computeRollup, relationDelta, targetFits, withLink, type RollupSource } from "./relation";
import { parseConfig } from "./views";
import { isRollup, isTwin } from "./property_schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<typeof db, "select" | "execute">;

// Les entrées déclarantes qui citent chacune des entrées demandées, dans
// l'ordre manuel de la base déclarante. Une seule requête par jumelle, quel
// que soit le nombre d'entrées affichées.
async function declarantsOf(
  executor: Pick<typeof db, "execute">,
  declDb: string,
  declProp: string,
  entryIds: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (entryIds.length === 0) return found;
  const listed = sql.join(
    entryIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await executor.execute<{ cited: string; declarant: string }>(sql`
    SELECT cite.value AS cited, d.id AS declarant
    FROM pages d
    CROSS JOIN LATERAL jsonb_array_elements_text(d.property_values -> ${declProp}) AS cite(value)
    WHERE d.db_id = ${declDb}
      AND d.type = 'entry'
      AND d.trashed_at IS NULL
      AND cite.value IN (${listed})
    ORDER BY d.manual_order, d.created_at`);
  for (const row of result.rows) {
    const list = found.get(row.cited);
    if (list) list.push(row.declarant);
    else found.set(row.cited, [row.declarant]);
  }
  return found;
}

// Les valeurs des jumelles, posées sur chaque entrée de la base cible. Une
// entrée qui n'est plus citée n'a pas de clé, sa cellule reste vide.
export async function fillTwins<T extends { id: string; values: Values }>(
  properties: readonly Property[],
  entries: readonly T[],
  executor: Executor = db,
): Promise<T[]> {
  const twins = properties.filter(isTwin);
  if (twins.length === 0 || entries.length === 0) return [...entries];
  const ids = entries.map((entry) => entry.id);
  const byTwin = new Map<string, Map<string, string[]>>();
  for (const twin of twins) {
    byTwin.set(twin.id, await declarantsOf(executor, twin.twinOf.db, twin.twinOf.prop, ids));
  }
  return entries.map((entry) => {
    const values: Values = { ...entry.values };
    let changed = false;
    for (const twin of twins) {
      const linked = byTwin.get(twin.id)?.get(entry.id);
      if (linked && linked.length > 0) {
        values[twin.id] = linked;
        changed = true;
      } else if (twin.id in values) {
        delete values[twin.id];
        changed = true;
      }
    }
    return changed ? { ...entry, values } : entry;
  });
}

// Un cumul prêt à calculer : sa relation traversée, la propriété visée lue
// dans la base cible (null pour « count »), et rien d'autre.
type RollupPlan = {
  prop: Property & { type: "rollup" };
  relation: Property & { type: "relation" };
  target: Property | null;
  calc: RollupCalc;
};

// Prépare les cumuls et repère ceux qui ne peuvent pas calculer : relation
// introuvable, base cible partie, propriété visée disparue ou d'un type
// étranger au calcul. Ces derniers font un tiret, signalé par l'en-tête.
async function planRollups(
  executor: Executor,
  properties: readonly Property[],
): Promise<{ plans: RollupPlan[]; broken: string[] }> {
  const plans: RollupPlan[] = [];
  const broken: string[] = [];
  // Un seul chargement de schéma par base cible, quel que soit le nombre de
  // cumuls qui la visent.
  const configs = new Map<string, Property[] | null>();
  for (const prop of properties.filter(isRollup)) {
    const relation = properties.find(
      (item) => item.id === prop.relation && item.type === "relation" && !item.twinOf,
    ) as (Property & { type: "relation" }) | undefined;
    if (!relation?.target) {
      broken.push(prop.id);
      continue;
    }
    let targetProps = configs.get(relation.target);
    if (targetProps === undefined) {
      const [base] = await executor
        .select({ dbConfig: pages.dbConfig, trashedAt: pages.trashedAt })
        .from(pages)
        .where(and(eq(pages.id, relation.target), eq(pages.type, "database")));
      targetProps = base && base.trashedAt === null ? parseConfig(base.dbConfig).properties : null;
      configs.set(relation.target, targetProps);
    }
    const target = targetProps?.find((item) => item.id === prop.target) ?? null;
    const calc = prop.calc ?? "count";
    if (!targetProps || !targetFits(calc, target)) {
      broken.push(prop.id);
      continue;
    }
    plans.push({ prop, relation, target, calc });
  }
  return { plans, broken };
}

// Les valeurs des entrées cibles citées par toute la page affichée, en une
// requête par cumul. Une entrée en corbeille ou purgée n'y est pas : elle
// cesse de compter.
async function citedTargets(
  executor: Executor,
  plan: RollupPlan,
  entries: readonly { values: Values }[],
): Promise<Map<string, Values>> {
  const cited = new Set<string>();
  for (const entry of entries) {
    const ids = normalizeValue(plan.relation, entry.values[plan.relation.id]);
    if (Array.isArray(ids)) for (const id of ids) cited.add(id);
  }
  const targets = new Map<string, Values>();
  if (cited.size === 0) return targets;
  const rows = await executor
    .select({ id: pages.id, propertyValues: pages.propertyValues })
    .from(pages)
    .where(
      and(
        inArray(pages.id, [...cited]),
        eq(pages.dbId, plan.relation.target ?? ""),
        eq(pages.type, "entry"),
        isNull(pages.trashedAt),
      ),
    );
  for (const row of rows) targets.set(row.id, asValues(row.propertyValues));
  return targets;
}

// Les sources d'un cumul pour une entrée : la valeur visée de chaque entrée
// liée qui vit encore. Un id cité mais purgé, en corbeille ou hors de la base
// cible n'apparaît pas.
function rollupSources(plan: RollupPlan, entry: { values: Values }, targets: Map<string, Values>): RollupSource[] {
  const ids = normalizeValue(plan.relation, entry.values[plan.relation.id]);
  return (Array.isArray(ids) ? ids : []).flatMap((id) => {
    const targetValues = targets.get(id);
    if (!targetValues) return [];
    const value: Value | undefined = plan.target ? normalizeValue(plan.target, targetValues[plan.target.id]) : undefined;
    return [{ value }];
  });
}

// Les valeurs calculées des cumuls, posées sur chaque entrée de la base. Une
// lecture par cumul, jamais une valeur stockée : le résultat suit une puce
// ajoutée ailleurs, une valeur changée dans la base cible, une entrée mise en
// corbeille. `brokenRollups` porte les cumuls qui ne peuvent pas calculer.
export async function fillRollups<T extends { id: string; values: Values }>(
  properties: readonly Property[],
  entries: readonly T[],
  executor: Executor = db,
): Promise<(T & { brokenRollups?: string[] })[]> {
  const rollups = properties.filter(isRollup);
  if (rollups.length === 0 || entries.length === 0) return [...entries];
  const { plans, broken } = await planRollups(executor, properties);

  const perEntry = new Map<string, Values>();
  for (const plan of plans) {
    const targets = await citedTargets(executor, plan, entries);
    for (const entry of entries) {
      const value = computeRollup(plan.calc, plan.target, rollupSources(plan, entry, targets));
      const computed = perEntry.get(entry.id) ?? {};
      if (value !== null) computed[plan.prop.id] = value;
      perEntry.set(entry.id, computed);
    }
  }

  return entries.map((entry) => {
    const values = { ...entry.values };
    // Aucune valeur de cumul ne doit survivre d'une lecture à l'autre.
    for (const prop of rollups) delete values[prop.id];
    Object.assign(values, perEntry.get(entry.id) ?? {});
    const next = { ...entry, values };
    return broken.length > 0 ? { ...next, brokenRollups: broken } : next;
  });
}

// Écrit depuis la jumelle : les entrées ajoutées reçoivent l'entrée citée dans
// leur relation déclarante, les entrées retirées la perdent. C'est la seule
// écriture croisée d'une relation, d'où la transaction et les verrous des deux
// bases pris par l'appelant, dans l'ordre de leurs ids.
export async function writeTwin(
  tx: Tx,
  twin: Property & { twinOf: TwinRef },
  citedId: string,
  wanted: readonly string[],
): Promise<void> {
  const declDb = twin.twinOf.db;
  const [base] = await tx.select({ dbConfig: pages.dbConfig }).from(pages).where(eq(pages.id, declDb));
  const declaring = parseConfig(base?.dbConfig).properties;
  const decl = declaring.find((prop) => prop.id === twin.twinOf.prop);
  // La relation déclarante a pu disparaître entre l'affichage et l'envoi : la
  // jumelle ne peut alors rien écrire.
  if (!decl || decl.type !== "relation") return;
  const current = (await declarantsOf(tx, declDb, decl.id, [citedId])).get(citedId) ?? [];
  const delta = relationDelta(current, wanted);
  const touched = [...delta.add, ...delta.remove];
  if (touched.length === 0) return;
  const rows = await tx
    .select({ id: pages.id, propertyValues: pages.propertyValues })
    .from(pages)
    .where(and(inArray(pages.id, touched), eq(pages.dbId, declDb), eq(pages.type, "entry"), isNull(pages.trashedAt)));
  for (const row of rows) {
    const values = { ...asValues(row.propertyValues) };
    const before = normalizeValue(decl, values[decl.id]);
    const list = Array.isArray(before) ? before : [];
    const after = withLink(decl, list, citedId, delta.add.includes(row.id));
    if (after.length > 0) values[decl.id] = after;
    else delete values[decl.id];
    // updated_at est laissée au $onUpdate de Drizzle : c'est bien une
    // modification de l'entrée, et la synchronisation doit la voir.
    await tx
      .update(pages)
      .set({ propertyValues: values, valuesText: valuesToText(declaring, values) })
      .where(eq(pages.id, row.id));
  }
}
