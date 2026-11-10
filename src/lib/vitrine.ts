// Vitrine de veille (étape 20), partie pure : servie au serveur comme au
// navigateur. Lecture des champs de la base, slugs, filtres à facettes,
// rangées, état d'adresse, suggestions et surlignage. Les requêtes vivent dans
// vitrine_query.ts, le pilotage depuis « Partager » dans vitrine_pilotage.ts.
//
// Seuls les champs de VITRINE_FIELDS sortent du serveur : toute autre
// propriété (Catégorie comprise) reste privée, même si la base en ajoute.
import {
  OPTION_COLORS,
  optionById,
  type EntryRow,
  type OptionColor,
  type Property,
  type PropertyType,
  type Value,
} from "./property_schema";
import type { RenderOptions } from "./blocks";
import { fold as foldWithOrigin, highlightSegments, searchTerms, type Segment } from "./search";

export const VITRINE_FIELDS = {
  description: { name: "Description", type: "text" },
  domaines: { name: "Domaine", type: "multiselect" },
  niveau: { name: "Niveau", type: "select" },
  prix: { name: "Prix", type: "multiselect" },
  type: { name: "Type", type: "multiselect" },
  site: { name: "Site Web", type: "url" },
  coeur: { name: "Coup de cœur", type: "checkbox" },
} as const satisfies Record<string, { name: string; type: PropertyType }>;

export type VitrineFieldKey = keyof typeof VITRINE_FIELDS;
export type VitrineFields = Record<VitrineFieldKey, Property | null>;

export type VitrineEntry = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  logo: string | null;
  description: string;
  domaines: string[];
  niveau: string | null;
  prix: string[];
  type: string[];
  site: string | null;
  siteKey: string | null;
  coeur: boolean;
  nouveau: boolean;
  hasNotes: boolean;
  createdAt: string;
  updatedAt: string;
};

export const NEW_DAYS = 30;
export const RECENT_COUNT = 12;
export const PANORAMA_TOP = 12;
export const QUERY_MAX = 200;
export const SLUG_MAX = 60;
export const NON_PRECISE = "non-precise";
const NON_PRECISE_LABEL = "Non précisé";
const DAY_MS = 86_400_000;

// Pli avec ligatures (« cœur » = « coeur »), celui de la recherche.
function plain(text: string): string {
  return foldWithOrigin(text).folded;
}

// Propriété attendue par nom plié et par type. Absente ou d'un autre type :
// null, le champ restera vide sans erreur.
export function vitrineFields(properties: readonly Property[]): VitrineFields {
  const out = {} as VitrineFields;
  for (const key of Object.keys(VITRINE_FIELDS) as VitrineFieldKey[]) {
    const { name, type } = VITRINE_FIELDS[key];
    const wanted = plain(name);
    out[key] = properties.find((prop) => prop.type === type && plain(prop.name.trim()) === wanted) ?? null;
  }
  return out;
}

function textOf(value: Value | undefined): string {
  return typeof value === "string" ? value : "";
}

function labelsOf(prop: Property | null, value: Value | undefined): string[] {
  if (!prop || !Array.isArray(value)) return [];
  return value.flatMap((id) => optionById(prop, id)?.name ?? []);
}

function labelOf(prop: Property | null, value: Value | undefined): string | null {
  if (!prop || typeof value !== "string") return null;
  return optionById(prop, value)?.name ?? null;
}

function valueOf(row: EntryRow, prop: Property | null): Value | undefined {
  return prop ? row.values[prop.id] : undefined;
}

// Adresse lue avec ou sans schéma ; http(s) seulement.
function parseSite(raw: string): URL | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

// Clé de comparaison d'un site : sans schéma, sans www, sans / final, sans
// requête ni ancre. Sert à repérer un doublon proposé.
export function siteKey(raw: string): string | null {
  const url = parseSite(raw);
  if (!url) return null;
  return `${hostOf(url)}${url.pathname.replace(/\/+$/, "")}`;
}

export function toVitrineEntry(
  row: EntryRow,
  fields: VitrineFields,
  options: { slug: string; hasNotes: boolean; now: number },
): VitrineEntry {
  // Adresse normalisée (schéma ajouté, http et https seuls) : elle part dans
  // le href de « Ouvrir le site », jamais le texte saisi.
  const raw = textOf(valueOf(row, fields.site)).trim();
  const url = raw ? parseSite(raw) : null;
  const site = url ? url.href : null;
  return {
    id: row.id,
    slug: options.slug,
    title: row.title,
    icon: row.icon,
    logo: url ? `/api/veille/logo/${encodeURIComponent(hostOf(url))}` : null,
    description: textOf(valueOf(row, fields.description)),
    domaines: labelsOf(fields.domaines, valueOf(row, fields.domaines)),
    niveau: labelOf(fields.niveau, valueOf(row, fields.niveau)),
    prix: labelsOf(fields.prix, valueOf(row, fields.prix)),
    type: labelsOf(fields.type, valueOf(row, fields.type)),
    site,
    siteKey: site ? siteKey(site) : null,
    coeur: valueOf(row, fields.coeur) === true,
    nouveau: options.now - Date.parse(row.createdAt) < NEW_DAYS * DAY_MS,
    hasNotes: options.hasNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function slugify(text: string): string {
  const slug = plain(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug || "ressource";
}

// Slugs uniques, attribués par ordre de création : la plus ancienne garde le
// slug nu, les suivantes reçoivent -2, -3…
export function assignSlugs(entries: readonly { id: string; title: string; createdAt: string }[]): Map<string, string> {
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const entry of ordered) {
    const base = slugify(entry.title);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(entry.id, slug);
  }
  return out;
}

// Familles de filtres, dans l'ordre de l'adresse.
export const FAMILIES = ["domaine", "niveau", "prix", "type"] as const;
export type Family = (typeof FAMILIES)[number];
// Seul Domaine n'offre pas « Non précisé » (§4 : menus Niveau, Prix, Type).
const WITH_NON_PRECISE: ReadonlySet<Family> = new Set(["niveau", "prix", "type"]);

export type VitrineState = Record<Family, string[]> & { q: string; coeur: boolean; fiche: string | null };

export function emptyVitrineState(): VitrineState {
  return { q: "", domaine: [], niveau: [], prix: [], type: [], coeur: false, fiche: null };
}

function familyLabels(entry: VitrineEntry, family: Family): string[] {
  if (family === "domaine") return entry.domaines;
  if (family === "niveau") return entry.niveau ? [entry.niveau] : [];
  return entry[family];
}

// Slugs d'une entrée dans une famille ; « non-precise » quand elle n'a rien.
function familySlugs(entry: VitrineEntry, family: Family): string[] {
  const labels = familyLabels(entry, family);
  if (!labels.length) return WITH_NON_PRECISE.has(family) ? [NON_PRECISE] : [];
  return labels.map(slugify);
}

function passes(entry: VitrineEntry, state: VitrineState, skip: Family | null): boolean {
  if (state.coeur && !entry.coeur) return false;
  for (const family of FAMILIES) {
    if (family === skip || !state[family].length) continue;
    const slugs = familySlugs(entry, family);
    if (!state[family].some((slug) => slugs.includes(slug))) return false;
  }
  return true;
}

// OU dans une famille, ET entre familles. La recherche n'y entre pas : elle
// est faite au serveur, le navigateur croise ensuite.
export function applyFilters(entries: readonly VitrineEntry[], state: VitrineState): VitrineEntry[] {
  return entries.filter((entry) => passes(entry, state, null));
}

export type Facet = { label: string; slug: string; count: number; active: boolean };
export type Facets = Record<Family, Facet[]>;

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// Chaque famille est comptée avec les filtres des autres seulement : cocher IA
// laisse visibles les autres domaines, qu'on peut ajouter en OU. Les libellés
// viennent de `universe` (toute la base par défaut) : une étiquette que
// personne ne porte n'apparaît pas, une étiquette sans résultat reste à 0.
export function facetCounts(
  entries: readonly VitrineEntry[],
  state: VitrineState,
  universe: readonly VitrineEntry[] = entries,
): Facets {
  const out = {} as Facets;
  for (const family of FAMILIES) {
    const labels = new Map<string, string>();
    let anyMissing = false;
    for (const entry of universe) {
      const own = familyLabels(entry, family);
      if (!own.length) anyMissing = true;
      for (const label of own) if (!labels.has(slugify(label))) labels.set(slugify(label), label);
    }
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (!passes(entry, state, family)) continue;
      for (const slug of new Set(familySlugs(entry, family))) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    const facets = [...labels].map(([slug, label]) => ({
      label,
      slug,
      count: counts.get(slug) ?? 0,
      active: state[family].includes(slug),
    }));
    facets.sort((a, b) => collator.compare(a.label, b.label));
    if (WITH_NON_PRECISE.has(family) && (anyMissing || state[family].includes(NON_PRECISE))) {
      facets.push({
        label: NON_PRECISE_LABEL,
        slug: NON_PRECISE,
        count: counts.get(NON_PRECISE) ?? 0,
        active: state[family].includes(NON_PRECISE),
      });
    }
    out[family] = facets;
  }
  return out;
}

// Panorama des domaines : les plus fournis d'abord, le reste à déplier.
export function panorama(facets: readonly Facet[], size = PANORAMA_TOP): { top: Facet[]; rest: Facet[] } {
  const byCount = [...facets].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
  const rest = byCount.slice(size).sort((a, b) => collator.compare(a.label, b.label));
  return { top: byCount.slice(0, size), rest };
}

export function heartRow(entries: readonly VitrineEntry[]): VitrineEntry[] {
  return entries.filter((entry) => entry.coeur).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function recentRow(entries: readonly VitrineEntry[], size = RECENT_COUNT): VitrineEntry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, size);
}

export function allRow(entries: readonly VitrineEntry[]): VitrineEntry[] {
  return [...entries].sort((a, b) => collator.compare(a.title, b.title));
}

// Recherche de deux lettres au moins, filtre ou coups de cœur : la rangée
// « Résultats » remplace la vitrine (§1, §2 : une lettre ne change rien).
export function isNarrowed(state: VitrineState): boolean {
  return state.q.trim().length >= 2 || state.coeur || FAMILIES.some((family) => state[family].length > 0);
}

export type VitrineView =
  | { kind: "empty" }
  | { kind: "vitrine"; heart: VitrineEntry[]; recent: VitrineEntry[]; all: VitrineEntry[] }
  | { kind: "results"; results: VitrineEntry[] };

// Ce que montre la page pour un état. `ranked` : slugs classés par la
// recherche du serveur, croisés ensuite avec les filtres ; null sans
// recherche, les résultats suivent alors l'ordre du titre.
export function vitrineView(entries: readonly VitrineEntry[], state: VitrineState, ranked: readonly string[] | null): VitrineView {
  if (!entries.length) return { kind: "empty" };
  if (!isNarrowed(state)) return { kind: "vitrine", heart: heartRow(entries), recent: recentRow(entries), all: allRow(entries) };
  const filtered = applyFilters(entries, state);
  if (!ranked) return { kind: "results", results: allRow(filtered) };
  const bySlug = new Map(filtered.map((entry) => [entry.slug, entry]));
  return { kind: "results", results: ranked.flatMap((slug) => bySlug.get(slug) ?? []) };
}

export function ficheHref(slug: string): string {
  return `/veille?fiche=${encodeURIComponent(slug)}`;
}

// Liens d'un corps rendu dans la vitrine (mot d'accueil, notes d'une fiche) :
// une entrée de la base mène à sa fiche ; toute autre page reste privée, un
// bloc dit « Contenu privé » sans la nommer, un lien dans une phrase garde
// son texte seul ; une vue liée ne rend rien (elle montrerait Catégorie).
export function vitrineRenderOptions(entries: readonly VitrineEntry[]): RenderOptions {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    subpage: (pageId) => {
      const entry = byId.get(pageId);
      return entry ? { href: ficheHref(entry.slug), title: entry.title, icon: entry.icon, type: "entry" } : "private";
    },
    internal: (pageId) => {
      const entry = byId.get(pageId);
      return entry ? ficheHref(entry.slug) : null;
    },
    linked: () => null,
  };
}

// searchParams de Next (valeurs simples ou en tableau) ou URLSearchParams.
export type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function paramAll(params: ParamSource, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// État lu dans l'adresse. Une valeur de filtre absente des entrées (étiquette
// renommée, lien bricolé) est ignorée ; `fiche` est gardé tel quel, la page
// dira s'il n'existe plus.
export function parseVitrineState(params: ParamSource, entries: readonly VitrineEntry[]): VitrineState {
  const state = emptyVitrineState();
  state.q = (paramAll(params, "q")[0] ?? "").slice(0, QUERY_MAX);
  for (const family of FAMILIES) {
    const known = new Set(entries.flatMap((entry) => familyLabels(entry, family).map(slugify)));
    if (WITH_NON_PRECISE.has(family)) known.add(NON_PRECISE);
    state[family] = [...new Set(paramAll(params, family))].filter((slug) => known.has(slug));
  }
  state.coeur = paramAll(params, "coeur")[0] === "1";
  state.fiche = paramAll(params, "fiche")[0] || null;
  return state;
}

// Adresse d'un état, sans « ? » ; chaîne vide pour la vitrine nue.
export function serializeVitrineState(state: VitrineState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  for (const family of FAMILIES) for (const slug of state[family]) params.append(family, slug);
  if (state.coeur) params.set("coeur", "1");
  if (state.fiche) params.set("fiche", state.fiche);
  return params.toString();
}

// Trigrammes à la manière de pg_trgm : mot entouré de deux espaces devant,
// d'un derrière.
function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const gram of ta) if (tb.has(gram)) common++;
  return common / (ta.size + tb.size - common);
}

export const SUGGEST_THRESHOLD = 0.3;
const SUGGEST_MAX = 3;

// Recherche sans résultat : étiquettes dont un mot ressemble à un mot tapé,
// les plus ressemblantes d'abord ; à défaut, les trois plus fournies.
export function suggestLabels(query: string, labels: readonly Facet[]): Facet[] {
  const usable = labels.filter((label) => label.count > 0);
  const words = plain(query).split(/[^a-z0-9]+/).filter((word) => word.length >= 2);
  const scored = usable
    .map((label) => {
      const labelWords = plain(label.label).split(/[^a-z0-9]+/).filter(Boolean);
      const score = Math.max(0, ...words.flatMap((w) => labelWords.map((l) => similarity(w, l))));
      return { label, score };
    })
    .filter((item) => item.score >= SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.label.count - a.label.count);
  if (scored.length) return scored.slice(0, SUGGEST_MAX).map((item) => item.label);
  return [...usable].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label)).slice(0, SUGGEST_MAX);
}

// Titre et description d'une carte de résultat : mots surlignés par préfixe plié.
export function highlightTerms(text: string, query: string): Segment[] {
  return highlightSegments(text, searchTerms(query));
}

const INITIAL_COLORS = OPTION_COLORS.filter((color) => color !== "gray");

// Couleur du rond d'initiale, dérivée du titre : stable d'un rendu à l'autre.
export function initialColor(title: string): OptionColor {
  let hash = 0;
  for (const char of plain(title)) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return INITIAL_COLORS[hash % INITIAL_COLORS.length];
}
