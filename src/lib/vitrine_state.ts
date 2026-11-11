// Vitrine de veille, gestes du visiteur (partie pure, navigateur) : filtres
// basculés, effacement, suggestion appliquée, pastilles actives, recherche
// affichée. Les règles de lecture (filtres, facettes, rangées, adresse)
// vivent dans vitrine.ts.
import { FAMILIES, allRow, serializeVitrineState, type Facet, type Facets, type Family, type VitrineEntry, type VitrineState, type VitrineView } from "./vitrine";
import type { VitrineSearch, VitrineSearchMode } from "./vitrine_search";
import { SEARCH_MIN_LENGTH } from "./search";

export function toggleFacet(state: VitrineState, family: Family, slug: string): VitrineState {
  const current = state[family];
  const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
  return { ...state, [family]: next };
}

export function toggleCoeur(state: VitrineState): VitrineState {
  return { ...state, coeur: !state.coeur };
}

// « Tout effacer » et ✕ : la vitrine revient ; une fiche ouverte le reste.
export function clearAll(state: VitrineState): VitrineState {
  return { q: "", domaine: [], niveau: [], prix: [], type: [], coeur: false, fiche: state.fiche };
}

// Suggestion d'une recherche sans résultat (§3) : vide la recherche, ajoute le domaine.
export function applySuggestion(state: VitrineState, slug: string): VitrineState {
  const domaine = state.domaine.includes(slug) ? state.domaine : [...state.domaine, slug];
  return { ...state, q: "", domaine };
}

// Valeur affichée dans un menu Niveau, Prix ou Type (« Prix : Gratuit ») :
// la case se lit comme un réglage, pas comme une étiquette de plus.
export function menuValue(facets: readonly Facet[]): string {
  const chosen = facets.filter((facet) => facet.active).map((facet) => facet.label);
  if (!chosen.length) return "tous";
  return chosen.length > 2 ? `${chosen.length} choisis` : chosen.join(", ");
}

export type ActiveFilter ={ family: Family | "coeur"; slug: string; label: string };

// Ligne des filtres actifs (§4), dans l'ordre de l'adresse. La recherche n'y
// figure pas : le ✕ du champ l'efface.
export function activeFilters(state: VitrineState, facets: Facets): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  for (const family of FAMILIES) {
    for (const slug of state[family]) {
      const label = facets[family].find((facet) => facet.slug === slug)?.label ?? slug;
      out.push({ family, slug, label });
    }
  }
  if (state.coeur) out.push({ family: "coeur", slug: "1", label: "★ Coups de cœur" });
  return out;
}

// Dernière recherche revenue du serveur, avec la requête qui l'a demandée.
export type SettledSearch = { q: string; search: VitrineSearch | null };

// Requête envoyée au serveur ; vide sous deux caractères (§2 : une lettre ne
// change rien).
export function searchKey(q: string): string {
  const trimmed = q.trim();
  return trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : "";
}

// Ce que la page montre pendant la frappe : la dernière recherche revenue
// tant que la nouvelle n'est pas là (pas de clignotement), la vitrine dès
// qu'il ne reste qu'une lettre.
export function shownSearch(q: string, settled: SettledSearch): SettledSearch {
  return searchKey(q) ? settled : { q, search: null };
}

// Entrées trouvées par la recherche : base des compteurs de facettes.
export function searchPool(entries: readonly VitrineEntry[], search: VitrineSearch | null): readonly VitrineEntry[] {
  if (!search) return entries;
  const found = new Set(search.results.map((result) => result.slug));
  return entries.filter((entry) => found.has(entry.slug));
}

export function resultsTitle(count: number, mode: VitrineSearchMode | null): string {
  return mode === "approchant" ? `Résultats approchants (${count})` : `Résultats (${count})`;
}

export function vitrineHref(state: VitrineState): string {
  const query = serializeVitrineState(state);
  return query ? `/veille?${query}` : "/veille";
}

// Fiche demandée par l'adresse : un slug, ou l'id d'une entrée (`pg_…`).
export function findFiche(entries: readonly VitrineEntry[], fiche: string | null): VitrineEntry | null {
  if (!fiche) return null;
  return entries.find((entry) => entry.slug === fiche) ?? entries.find((entry) => entry.id === fiche) ?? null;
}

// État lu au chargement (§6) : un id devient le slug ; une fiche inconnue
// (supprimée, renommée, en corbeille) est retirée et signalée par le bandeau.
export function resolveFiche(state: VitrineState, entries: readonly VitrineEntry[]): { state: VitrineState; missing: boolean } {
  if (!state.fiche) return { state, missing: false };
  const entry = findFiche(entries, state.fiche);
  return { state: { ...state, fiche: entry ? entry.slug : null }, missing: !entry };
}

// Rangée d'où la fiche a été ouverte ; `all` pour un lien direct.
export type SheetRow = "coeur" | "recent" | "results" | "all";

function rowList(view: VitrineView, entries: readonly VitrineEntry[], row: SheetRow): readonly VitrineEntry[] {
  if (view.kind === "results") return view.results;
  if (view.kind === "empty") return entries;
  if (row === "coeur") return view.heart;
  if (row === "recent") return view.recent;
  return view.all;
}

// Voisines de la fiche dans sa rangée d'origine (‹ › et ← →), sans boucler.
// Une fiche absente de la rangée (atteinte par un lien des notes) suit
// toutes les ressources, dans l'ordre du titre.
export function sheetNeighbors(
  view: VitrineView,
  entries: readonly VitrineEntry[],
  row: SheetRow,
  slug: string,
): { prev: string | null; next: string | null } {
  let list = rowList(view, entries, row);
  let index = list.findIndex((entry) => entry.slug === slug);
  if (index < 0) {
    list = allRow(entries);
    index = list.findIndex((entry) => entry.slug === slug);
  }
  if (index < 0) return { prev: null, next: null };
  return { prev: list[index - 1]?.slug ?? null, next: list[index + 1]?.slug ?? null };
}

// Lien des notes vers une autre fiche (`/veille?fiche=…`, rendu par
// vitrineRenderOptions) : la fiche change sur place au lieu de recharger.
export function ficheFromHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/veille") return null;
  return url.searchParams.get("fiche") || null;
}
