"use client";
// Vitrine interactive (§1 à §4, §7 à §9) : tient l'état du visiteur
// (recherche, filtres, coups de cœur), le reporte dans l'adresse par
// history.replaceState (jamais router.replace, qui relancerait le rendu
// serveur ; aucune entrée d'historique par frappe), et interroge le serveur
// 200 ms après la dernière frappe, la requête précédente annulée.
//
// Le rendu serveur reçoit le même état et la même recherche : l'hydratation
// retrouve exactement la page déjà affichée. Pendant la frappe, la page montre
// la dernière recherche revenue (shownSearch), jamais un tri provisoire.
import { useEffect, useState, useSyncExternalStore } from "react";
import { QUERY_MAX, facetCounts, isNarrowed, suggestLabels, vitrineView, type Family, type VitrineEntry, type VitrineState } from "@/lib/vitrine";
import type { VitrineSearch as SearchResponse } from "@/lib/vitrine_search";
import {
  activeFilters,
  applySuggestion,
  clearAll,
  resultsTitle,
  searchKey,
  searchPool,
  shownSearch,
  toggleCoeur,
  toggleFacet,
  vitrineHref,
  type SettledSearch,
} from "@/lib/vitrine_state";
import type { CardHighlight } from "./VitrineCard";
import { VitrineFacets } from "./VitrineFacets";
import { VitrineGrid } from "./VitrineGrid";
import { VitrineRow } from "./VitrineRow";
import { VitrineSearch } from "./VitrineSearch";

const SEARCH_DELAY = 200;

type Props = { entries: VitrineEntry[]; initialState: VitrineState; initialSearch: SearchResponse | null };

const noSubscribe = () => () => {};

export function Vitrine({ entries, initialState, initialSearch }: Props) {
  const [state, setState] = useState(initialState);
  const [settled, setSettled] = useState<SettledSearch>({ q: initialSearch ? searchKey(initialState.q) : "", search: initialSearch });
  const [failed, setFailed] = useState(false);
  // Origine lue après l'hydratation : le serveur ne la connaît pas.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    const href = vitrineHref(state);
    if (href !== window.location.pathname + window.location.search) window.history.replaceState(null, "", href);
  }, [state]);

  const key = searchKey(state.q);
  useEffect(() => {
    if (!key || key === settled.q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/veille/recherche?q=${encodeURIComponent(key)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const search = (await response.json()) as SearchResponse;
        setSettled({ q: key, search });
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }, SEARCH_DELAY);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, settled.q]);

  const shown = shownSearch(state.q, settled);
  const viewState = { ...state, q: shown.q };
  const view = vitrineView(entries, viewState, shown.search ? shown.search.results.map((result) => result.slug) : null);
  const facets = facetCounts(searchPool(entries, shown.search), viewState, entries);
  const narrowed = isNarrowed(viewState);

  const onToggle = (family: Family, slug: string) => setState((s) => toggleFacet(s, family, slug));

  if (view.kind === "empty") return <p className="vitrine-empty">La veille est en cours de constitution.</p>;

  return (
    <>
      <div className="vitrine-controls">
        <VitrineSearch
          value={state.q}
          failed={failed && Boolean(key) && key !== settled.q}
          onChange={(q) => setState((s) => ({ ...s, q: q.slice(0, QUERY_MAX) }))}
        />
        <VitrineFacets
          facets={facets}
          coeur={state.coeur}
          hasHearts={entries.some((entry) => entry.coeur)}
          narrowed={narrowed}
          shown={view.kind === "results" ? view.results.length : entries.length}
          active={activeFilters(state, facets)}
          url={origin + vitrineHref({ ...state, fiche: null })}
          onToggle={onToggle}
          onCoeur={() => setState(toggleCoeur)}
          onClear={() => setState(clearAll)}
        />
      </div>
      {view.kind === "vitrine" ? (
        <>
          {view.heart.length ? <VitrineRow id="coeur" title="★ Coups de cœur" entries={view.heart} /> : null}
          <VitrineRow id="recent" title="✦ Ajoutés récemment" entries={view.recent} />
          <VitrineGrid entries={view.all} />
        </>
      ) : (
        <VitrineRow
          id="results"
          title={resultsTitle(view.results.length, shown.search?.mode ?? null)}
          entries={view.results}
          highlight={highlightOf(shown)}
          empty={
            shown.search && !shown.search.total ? (
              <NoResults
                query={shown.q}
                suggestions={suggestLabels(shown.q, facetCounts(entries, { ...viewState, q: "" }).domaine)}
                onPick={(slug) => setState((s) => applySuggestion(s, slug))}
              />
            ) : (
              <p className="vitrine-row-empty">Aucune ressource ne correspond à ces filtres.</p>
            )
          }
        />
      )}
    </>
  );
}

function highlightOf(shown: SettledSearch): CardHighlight | undefined {
  if (!shown.search) return undefined;
  const snippets = new Map<string, string>();
  for (const result of shown.search.results) if (result.snippet) snippets.set(result.slug, result.snippet);
  return { query: shown.q, snippets };
}

// Recherche sans résultat (§3) : étiquettes proches d'un mot tapé, ou les
// plus fournies ; un clic vide la recherche et applique le filtre.
function NoResults({ query, suggestions, onPick }: { query: string; suggestions: { label: string; slug: string; count: number }[]; onPick: (slug: string) => void }) {
  return (
    <div className="vitrine-none">
      <p>Aucune ressource ne contient « {query.trim()} ».</p>
      {suggestions.length ? (
        <p className="vitrine-suggest">
          Essaie plutôt :{" "}
          {suggestions.map((facet) => (
            <button key={facet.slug} type="button" className="vitrine-pill" onClick={() => onPick(facet.slug)}>
              {facet.label} · {facet.count}
            </button>
          ))}
        </p>
      ) : null}
    </div>
  );
}
