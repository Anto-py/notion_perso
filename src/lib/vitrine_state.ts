// Vitrine de veille, gestes du visiteur (partie pure, navigateur) : filtres
// basculés, effacement, suggestion appliquée, pastilles actives, recherche
// affichée. Les règles de lecture (filtres, facettes, rangées, adresse)
// vivent dans vitrine.ts.
import { FAMILIES, serializeVitrineState, type Facets, type Family, type VitrineEntry, type VitrineState } from "./vitrine";
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

export type ActiveFilter = { family: Family | "coeur"; slug: string; label: string };

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
