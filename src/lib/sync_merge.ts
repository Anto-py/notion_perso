// Fusion à trois versions d'une page (SPECS.md, « Synchronisation avec l'app
// Mac »). Le serveur la lance quand le Mac pousse une ligne que le web a aussi
// modifiée depuis : base commune (la dernière version que le Mac a reçue),
// version du Mac, version du serveur.
//
// Changé d'un seul côté, ce côté passe tel quel. Changé des deux côtés, on
// descend d'un cran : champ par champ, valeur par valeur, propriété, option et
// vue par id, bloc par bloc. Sur un même élément, la ligne la plus récemment
// modifiée (updated_at) gagne ; pour un bloc, l'autre version est gardée juste
// en dessous dans un encadré `conflict`. Module pur : ni base, ni réseau.
import { LIMITS, fold, isOptionType, uniqueName, type Property, type SelectOption } from "./properties";
import { parseConfig, sanitizeViews } from "./views";

export type Side = "mac" | "web";

// Ligne de `pages` telle qu'elle voyage, sans les champs dérivés (body_text,
// values_text, search_vector), recalculés à la réception par lib/.
export type SyncPage = {
  id: string;
  parentId: string | null;
  type: "page" | "database" | "entry";
  title: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number | null;
  body: unknown;
  dbConfig: unknown;
  dbId: string | null;
  propertyValues: Record<string, unknown> | null;
  inboxKind: "link" | "note" | null;
  isInbox: boolean;
  manualOrder: string;
  shareEnabled: boolean;
  publicId: string | null;
  shareIncludeSubpages: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
};

export type MergeResult = { page: SyncPage; conflicts: number };

// Encadré qui garde la version perdante d'un bloc. replaces : id du bloc
// rival ; « Garder celle-ci » le remplace, ou prend la place de l'encadré si
// ce bloc a été supprimé entre-temps.
export const CONFLICT_BLOCK = "conflict";
export type ConflictProps = { origin: Side; date: string; replaces: string };

// Champs fusionnés ensemble : un bandeau ne mêle pas l'image d'un côté et le
// cadrage de l'autre, ni un partage l'état de l'un et le lien de l'autre.
const FIELD_GROUPS: (keyof SyncPage)[][] = [
  ["title"],
  ["parentId"],
  ["type"],
  ["icon"],
  ["cover", "coverPosition"],
  ["trashedAt"],
  ["isInbox"],
  ["shareEnabled", "publicId", "shareIncludeSubpages"],
];
// moveEntry réécrit ces quatre champs d'un seul geste : quand les deux côtés
// ne désignent plus la même base, ils suivent ensemble le côté qui a déplacé.
// Les valeurs modifiées de l'autre côté visaient le schéma d'une base que
// l'entrée a quittée.
const MOVE_GROUP: (keyof SyncPage)[] = ["dbId", "propertyValues", "inboxKind", "manualOrder"];
const COLUMN_LIST = "columnList";

type Json = unknown;
type Obj = Record<string, Json>;
type Keyed = Obj & { id: string };
type Ctx = { newer: Side; dates: Record<Side, string>; makeId: () => string; conflicts: number };

function isObj(value: Json): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Égalité de JSON, indifférente à l'ordre des clés (jsonb les réordonne) ; une
// clé à undefined vaut une clé absente.
function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (!isObj(a) || !isObj(b)) return false;
  const keys = (o: Obj) => Object.keys(o).filter((key) => o[key] !== undefined);
  const ka = keys(a);
  return ka.length === keys(b).length && ka.every((key) => sameJson(a[key], b[key]));
}

const BOTH = Symbol("both");

// Ce qui l'emporte quand au plus un côté a changé, BOTH sinon. base undefined :
// pas de base commune (ligne renvoyée après une coupure), tout écart compte
// comme un changement des deux côtés.
function settled<T>(base: T | undefined, mac: T, web: T): T | typeof BOTH {
  if (sameJson(mac, web)) return web;
  if (base !== undefined && sameJson(base, mac)) return web;
  if (base !== undefined && sameJson(base, web)) return mac;
  return BOTH;
}

function pick<T>(base: T | undefined, mac: T, web: T, newer: Side): T {
  const value = settled(base, mac, web);
  if (value !== BOTH) return value;
  return newer === "mac" ? mac : web;
}

function slice(page: SyncPage, keys: readonly (keyof SyncPage)[]): Obj {
  return Object.fromEntries(keys.map((key) => [key, page[key]]));
}

// --- Listes ordonnées d'éléments à id ---------------------------------------

type ListRules<T> = {
  // Présent des deux côtés (base absente si ajouté des deux côtés).
  both(base: T | undefined, mac: T, web: T): T[];
  // Présent d'un seul côté : ajouté là (base absente), ou gardé là et supprimé
  // de l'autre côté. [] retire l'élément.
  one(base: T | undefined, item: T, side: Side): T[];
};

function keyedList(raw: Json): Keyed[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObj(item) || typeof item.id !== "string" || ids.has(item.id)) return null;
    ids.add(item.id);
  }
  return raw as Keyed[];
}

// L'ordre relatif des éléments communs a-t-il bougé depuis la base ?
function sameOrder(list: readonly Keyed[], base: ReadonlyMap<string, Keyed>): boolean {
  const ids = new Set(list.map((item) => item.id));
  const kept = list.filter((item) => base.has(item.id)).map((item) => item.id);
  const ref = [...base.keys()].filter((id) => ids.has(id));
  return kept.length === ref.length && kept.every((id, i) => id === ref[i]);
}

// L'ordre suit le côté qui a réordonné (le plus récent si les deux l'ont
// fait) ; ce que l'autre côté est seul à porter s'insère après son voisin
// précédent chez lui, qui y reste donc collé.
function mergeList<T extends Keyed>(base: readonly T[], mac: readonly T[], web: readonly T[], newer: Side, rules: ListRules<T>): T[] {
  const byId = (list: readonly T[]) => new Map(list.map((item) => [item.id, item]));
  const [b, m, w] = [byId(base), byId(mac), byId(web)];
  const resolve = (id: string): T[] => {
    const [inBase, inMac, inWeb] = [b.get(id), m.get(id), w.get(id)];
    if (inMac && inWeb) return rules.both(inBase, inMac, inWeb);
    if (inMac) return rules.one(inBase, inMac, "mac");
    return inWeb ? rules.one(inBase, inWeb, "web") : [];
  };
  const macMoved = !sameOrder(mac, b);
  const webMoved = !sameOrder(web, b);
  const lead: Side = macMoved !== webMoved ? (macMoved ? "mac" : "web") : newer;
  const [first, second] = lead === "mac" ? [mac, web] : [web, mac];
  const groups = first.map((item) => ({ id: item.id, items: resolve(item.id) }));
  let at = -1;
  for (const item of second) {
    const found = groups.findIndex((group) => group.id === item.id);
    if (found !== -1) {
      at = found;
      continue;
    }
    groups.splice(at + 1, 0, { id: item.id, items: resolve(item.id) });
    at++;
  }
  return groups.flatMap((group) => group.items);
}

// Élément indivisible (vue, option) : le changement d'un seul côté passe ;
// supprimé d'un côté et modifié de l'autre, le plus récent tranche.
function atomicRules<T extends Keyed>(newer: Side): ListRules<T> {
  return {
    both: (base, mac, web) => [pick(base, mac, web, newer)],
    one: (base, item, side) => (!base || (!sameJson(base, item) && side === newer) ? [item] : []),
  };
}

// --- Corps BlockNote ---------------------------------------------------------

function childrenOf(block: Obj | undefined): Json[] | undefined {
  if (!block) return undefined;
  return Array.isArray(block.children) ? block.children : [];
}

function ownPart(block: Keyed): Keyed {
  const own = { ...block };
  delete own.children;
  return own;
}

function withNewIds(block: Json, makeId: () => string): Json {
  if (!isObj(block)) return block;
  const children = childrenOf(block)!.map((child) => withNewIds(child, makeId));
  return { ...block, id: makeId(), children };
}

function conflictBox(block: Obj, side: Side, ctx: Ctx): Obj {
  ctx.conflicts++;
  const props: ConflictProps = { origin: side, date: ctx.dates[side], replaces: String(block.id) };
  return { id: ctx.makeId(), type: CONFLICT_BLOCK, props, children: [withNewIds(block, ctx.makeId)] };
}

// boxed : faux sous une rangée de colonnes, qui ne contient que des colonnes ;
// la version perdante y est alors écartée, la colonne revenue gardée nue.
function mergeBlocks(base: Json, mac: Json, web: Json, ctx: Ctx, boxed = true): Json[] {
  const value = settled(base, mac, web);
  if (value !== BOTH) return Array.isArray(value) ? value : [];
  const [b, m, w] = [keyedList(base ?? []), keyedList(mac), keyedList(web)];
  if (!b || !m || !w) {
    const newer = ctx.newer === "mac" ? mac : web;
    return Array.isArray(newer) ? newer : [];
  }
  return mergeList<Keyed>(b, m, w, ctx.newer, {
    both: (inBase, inMac, inWeb) => {
      const inner = inMac.type !== COLUMN_LIST && inWeb.type !== COLUMN_LIST;
      const children = mergeBlocks(childrenOf(inBase), childrenOf(inMac), childrenOf(inWeb), ctx, inner);
      const own = settled(inBase && ownPart(inBase), ownPart(inMac), ownPart(inWeb));
      if (own !== BOTH) return [{ ...own, children }];
      const [winner, loser, loserSide]: [Keyed, Keyed, Side] = ctx.newer === "mac" ? [inMac, inWeb, "web"] : [inWeb, inMac, "mac"];
      const merged: Keyed = { ...ownPart(winner), children };
      return boxed ? [merged, conflictBox(loser, loserSide, ctx) as Keyed] : [merged];
    },
    one: (inBase, item, side) => {
      if (!inBase) return [item];
      if (sameJson(inBase, item)) return [];
      // Supprimé d'un côté, modifié de l'autre : la modification revient.
      return boxed ? [conflictBox(item, side, ctx) as Keyed] : [item];
    },
  });
}

// Un bloc déplacé des deux côtés vers deux endroits différents y figure deux
// fois : la seconde occurrence reçoit un id neuf plutôt que de disparaître.
function distinctIds(blocks: Json[], seen: Set<string>, makeId: () => string): Json[] {
  return blocks.map((block) => {
    if (!isObj(block)) return block;
    const id = typeof block.id === "string" && !seen.has(block.id) ? block.id : makeId();
    seen.add(id);
    const children = Array.isArray(block.children) ? distinctIds(block.children, seen, makeId) : block.children;
    return { ...block, id, children };
  });
}

// --- Configuration d'une base ------------------------------------------------

// validateProperties rejette une configuration entière dès que deux noms se
// confondent (parseConfig la lirait vide) : deux « Statut » créés chacun de
// leur côté, le second est renommé « Statut 2 ».
function distinctNames<T extends { name: string }>(items: T[], unique: (kept: T[], name: string) => string): T[] {
  const kept: T[] = [];
  for (const item of items) {
    let name = unique(kept, item.name);
    if (name.length > LIMITS.name) name = unique(kept, item.name.slice(0, LIMITS.name - 4));
    kept.push({ ...item, name });
  }
  return kept;
}

// Comme uniqueName, sans réserver « Titre », qui n'est pris que parmi les
// propriétés : une option peut s'appeler ainsi.
function uniqueOptionName(kept: SelectOption[], name: string): string {
  const taken = new Set(kept.map((option) => fold(option.name)));
  if (!taken.has(fold(name))) return name;
  let n = 2;
  while (taken.has(fold(`${name} ${n}`))) n++;
  return `${name} ${n}`;
}

function withoutOptions(prop: Property): Property {
  const own = { ...prop };
  delete own.options;
  return own;
}

// Une option créée à la volée de chaque côté sur la même Sélection : les deux
// restent, d'où une fusion des options par id sous la propriété.
function mergeProperty(base: Property | undefined, mac: Property, web: Property, newer: Side): Property {
  const prop = pick(base && withoutOptions(base), withoutOptions(mac), withoutOptions(web), newer);
  if (!isOptionType(prop.type)) return prop;
  const options = mergeList(base?.options ?? [], mac.options ?? [], web.options ?? [], newer, atomicRules<SelectOption>(newer));
  return { ...prop, options: distinctNames(options, uniqueOptionName).slice(0, LIMITS.options) };
}

function mergeConfig(base: Json, mac: Json, web: Json, newer: Side): Json {
  const value = settled(base, mac, web);
  if (value !== BOTH) return value;
  if (mac == null || web == null) return newer === "mac" ? mac : web;
  const [b, m, w] = [base == null ? undefined : parseConfig(base), parseConfig(mac), parseConfig(web)];
  const merged = mergeList<Property>(b?.properties ?? [], m.properties, w.properties, newer, {
    both: (inBase, inMac, inWeb) => [mergeProperty(inBase, inMac, inWeb, newer)],
    one: atomicRules<Property>(newer).one,
  });
  const properties = distinctNames(merged, uniqueName).slice(0, LIMITS.properties);
  const views = mergeList(b?.views ?? [], m.views, w.views, newer, atomicRules(newer));
  return { properties, views: sanitizeViews(views, properties) };
}

// --- Valeurs de propriétés ---------------------------------------------------

// Clé par clé, une valeur absente valant une valeur vide. Sans base commune,
// une valeur qu'un seul côté porte est gardée, comme un bloc (choix
// d'Antonin) : une saisie ne se perd pas, quitte à faire revenir un effacement.
function mergeValues(
  base: Record<string, Json> | null | undefined,
  mac: Record<string, Json> | null,
  web: Record<string, Json> | null,
  newer: Side,
): Record<string, Json> | null {
  if (mac == null && web == null) return null;
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(mac ?? {}), ...Object.keys(web ?? {})]);
  const values: Record<string, Json> = {};
  for (const key of keys) {
    const [inMac, inWeb] = [mac?.[key] ?? null, web?.[key] ?? null];
    const value =
      base === undefined
        ? inMac === null || inWeb === null
          ? (inMac ?? inWeb)
          : pick(undefined, inMac, inWeb, newer)
        : pick(base?.[key] ?? null, inMac, inWeb, newer);
    if (value !== null) values[key] = value;
  }
  return values;
}

// --- Ligne entière -----------------------------------------------------------

// base nulle : pas de version commune, par exemple une ligne renvoyée par le
// Mac après une coupure survenue avant l'accusé de réception.
export function mergePage(base: SyncPage | null, mac: SyncPage, web: SyncPage, makeId: () => string = () => crypto.randomUUID()): MergeResult {
  const newer: Side = Date.parse(mac.updatedAt) > Date.parse(web.updatedAt) ? "mac" : "web";
  const ctx: Ctx = { newer, dates: { mac: mac.updatedAt, web: web.updatedAt }, makeId, conflicts: 0 };
  const page = { ...web } as Record<keyof SyncPage, Json>;

  for (const keys of FIELD_GROUPS) {
    Object.assign(page, pick(base ? slice(base, keys) : undefined, slice(mac, keys), slice(web, keys), newer));
  }

  if (mac.dbId !== web.dbId) {
    const moved = (side: SyncPage) => base !== null && side.dbId !== base.dbId;
    const lead = moved(mac) !== moved(web) ? (moved(mac) ? mac : web) : newer === "mac" ? mac : web;
    Object.assign(page, slice(lead, MOVE_GROUP));
  } else {
    const common = base !== null && base.dbId === web.dbId ? base : undefined;
    page.propertyValues = mergeValues(common?.propertyValues, mac.propertyValues, web.propertyValues, newer);
    page.inboxKind = pick(common?.inboxKind, mac.inboxKind, web.inboxKind, newer);
    page.manualOrder = pick(common?.manualOrder, mac.manualOrder, web.manualOrder, newer);
  }

  page.dbConfig = mergeConfig(base ? base.dbConfig : undefined, mac.dbConfig, web.dbConfig, newer);
  const body = mergeBlocks(base ? base.body : undefined, mac.body, web.body, ctx);
  page.body = distinctIds(body, new Set(), makeId);
  page.updatedAt = newer === "mac" ? mac.updatedAt : web.updatedAt;
  return { page: page as SyncPage, conflicts: ctx.conflicts };
}
