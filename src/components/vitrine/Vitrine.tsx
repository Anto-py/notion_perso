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
//
// Fiche (§6) : l'ouverture par une carte empile une entrée d'historique
// marquée { vitrineFiche: true } ; voisines et liens des notes la remplacent.
// Fermer défait cette entrée (history.back) si elle existe, sinon retire
// `fiche` sur place (lien direct). Le marqueur se lit dans history.state, donc
// reste juste après un Retour puis un Avancer. Next recopie ses propres clés
// (__NA) dans nos pushState et replaceState : on lui passe toujours un objet
// neuf, jamais history.state, qu'il laisserait passer sans suivre l'adresse.
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { QUERY_MAX, facetCounts, isNarrowed, suggestLabels, vitrineView, type Family, type VitrineEntry, type VitrineState } from "@/lib/vitrine";
import type { VitrineSearch as SearchResponse } from "@/lib/vitrine_search";
import {
  activeFilters,
  applySuggestion,
  clearAll,
  findFiche,
  resultsTitle,
  searchKey,
  searchPool,
  sheetNeighbors,
  shownSearch,
  toggleCoeur,
  toggleFacet,
  vitrineHref,
  type SettledSearch,
  type SheetRow,
} from "@/lib/vitrine_state";
import type { CardHighlight } from "./VitrineCard";
import { VitrineFacets } from "./VitrineFacets";
import { VitrineGrid } from "./VitrineGrid";
import { VitrineProposal } from "./VitrineProposal";
import { VitrineRow } from "./VitrineRow";
import { VitrineSearch } from "./VitrineSearch";
import { VitrineSheet } from "./VitrineSheet";

const SEARCH_DELAY = 200;
const FICHE_MARK = "vitrineFiche";

type Props = { entries: VitrineEntry[]; initialState: VitrineState; initialSearch: SearchResponse | null; missingFiche: boolean };
type Transform = (state: VitrineState) => VitrineState;

const noSubscribe = () => () => {};

// Entrée d'historique empilée par l'ouverture d'une fiche.
function pushedFiche(): boolean {
  const data: unknown = window.history.state;
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)[FICHE_MARK] === true;
}

function historyData() {
  return pushedFiche() ? { [FICHE_MARK]: true } : null;
}

// Rend le focus à la carte de la fiche fermée, dans sa rangée d'origine si
// elle y est encore (une étiquette cliquée a pu changer la page).
function focusCard(slug: string, row: SheetRow) {
  const fiche = CSS.escape(slug);
  const link =
    document.querySelector<HTMLElement>(`a[data-fiche="${fiche}"][data-row="${row}"]`) ??
    document.querySelector<HTMLElement>(`a[data-fiche="${fiche}"]`);
  link?.focus();
}

export function Vitrine({ entries, initialState, initialSearch, missingFiche }: Props) {
  const [state, setState] = useState(initialState);
  const [sheetRow, setSheetRow] = useState<SheetRow>("all");
  const [missing, setMissing] = useState(missingFiche);
  const [proposing, setProposing] = useState(false);
  // Fermeture par history.back() en cours, et ce qu'elle appliquera au retour
  // (filtre d'une étiquette) : un second Échap ne recule pas d'une page.
  const closing = useRef<{ then: Transform | null } | null>(null);
  const lastFiche = useRef(initialState.fiche);
  const [settled, setSettled] = useState<SettledSearch>({ q: initialSearch ? searchKey(initialState.q) : "", search: initialSearch });
  const [failed, setFailed] = useState(false);
  // Origine lue après l'hydratation : le serveur ne la connaît pas.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    const href = vitrineHref(state);
    if (href !== window.location.pathname + window.location.search) window.history.replaceState(historyData(), "", href);
  }, [state]);

  // Retour et Avancer : la fiche suit l'adresse (§9).
  useEffect(() => {
    function onPopState() {
      const pending = closing.current;
      closing.current = null;
      const fiche = findFiche(entries, new URLSearchParams(window.location.search).get("fiche"))?.slug ?? null;
      setState((s) => {
        const next = { ...s, fiche };
        return pending?.then ? pending.then(next) : next;
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [entries]);

  // Fiche fermée : le focus revient à sa carte. VitrineSheet a déjà fermé
  // le <dialog> (les effets d'un enfant passent avant ceux du parent).
  useEffect(() => {
    const previous = lastFiche.current;
    lastFiche.current = state.fiche;
    if (previous && !state.fiche) focusCard(previous, sheetRow);
  }, [state.fiche, sheetRow]);

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

  function openSheet(slug: string, row: SheetRow) {
    const next = { ...state, fiche: slug };
    window.history.pushState({ [FICHE_MARK]: true }, "", vitrineHref(next));
    setSheetRow(row);
    setMissing(false);
    setState(next);
  }

  function closeSheet(then: Transform | null = null) {
    if (closing.current) return;
    if (pushedFiche()) {
      closing.current = { then };
      window.history.back();
      return;
    }
    setState((s) => {
      const next = { ...s, fiche: null };
      return then ? then(next) : next;
    });
  }

  // Clic sur une carte (lien étiré du titre) : la fiche s'ouvre sur place. Un
  // clic modifié (nouvel onglet) garde le comportement du lien.
  function onCardClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLElement>("a[data-fiche]");
    if (!link) return;
    event.preventDefault();
    openSheet(link.dataset.fiche!, (link.dataset.row as SheetRow | undefined) ?? "all");
  }

  const sheetEntry = findFiche(entries, state.fiche);
  const neighbors = sheetEntry ? sheetNeighbors(view, entries, sheetRow, sheetEntry.slug) : { prev: null, next: null };

  // Formulaire de proposition (§11) ; « voir » sur un doublon le ferme et
  // ouvre la fiche de la ressource déjà présente.
  const proposeButton = (
    <button type="button" className="vitrine-propose" onClick={() => setProposing(true)}>
      Proposer +
    </button>
  );
  const proposal = (
    <VitrineProposal
      open={proposing}
      entries={entries}
      onClose={() => setProposing(false)}
      onSee={(slug) => {
        setProposing(false);
        openSheet(slug, "all");
      }}
    />
  );

  if (view.kind === "empty") {
    return (
      <>
        <p className="vitrine-empty">La veille est en cours de constitution.</p>
        {proposeButton}
        {proposal}
      </>
    );
  }

  return (
    <>
      <div className="vitrine-propose-line">{proposeButton}</div>
      {missing ? (
        <p className="vitrine-missing" role="status">
          Cette ressource n&apos;est plus dans la veille.
        </p>
      ) : null}
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
      <div className="vitrine-cards" onClick={onCardClick}>
        {view.kind === "vitrine" ? (
          <>
            {view.heart.length ? <VitrineRow id="coeur" title="★ Coups de cœur" entries={view.heart} autoScroll="gauche" /> : null}
            <VitrineRow id="recent" title="✦ Ajoutés récemment" entries={view.recent} autoScroll="droite" />
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
                  onPropose={() => setProposing(true)}
                />
              ) : (
                <p className="vitrine-row-empty">Aucune ressource ne correspond à ces filtres.</p>
              )
            }
          />
        )}
      </div>
      <VitrineSheet
        entry={sheetEntry}
        prev={findFiche(entries, neighbors.prev)}
        next={findFiche(entries, neighbors.next)}
        url={origin + vitrineHref(state)}
        onClose={() => closeSheet()}
        onGo={(slug) => setState((s) => ({ ...s, fiche: slug }))}
        onTag={(slug) => closeSheet((s) => (s.domaine.includes(slug) ? s : toggleFacet(s, "domaine", slug)))}
      />
      {proposal}
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
// plus fournies ; un clic vide la recherche et applique le filtre. « Le
// proposer » ouvre le formulaire (§11).
function NoResults({
  query,
  suggestions,
  onPick,
  onPropose,
}: {
  query: string;
  suggestions: { label: string; slug: string; count: number }[];
  onPick: (slug: string) => void;
  onPropose: () => void;
}) {
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
      <p className="vitrine-suggest">
        Tu connais un outil qui manque ?{" "}
        <button type="button" className="vitrine-pill" onClick={onPropose}>
          Le proposer
        </button>
      </p>
    </div>
  );
}
