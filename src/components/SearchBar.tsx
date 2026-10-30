"use client";
// Barre de recherche en haut de la sidebar. Tant que la requête n'a pas deux
// caractères utiles, elle affiche ses enfants (l'arbre) ; au-delà, la liste
// des résultats prend leur place. Requête après 200 ms de calme, la
// précédente annulée : seule la dernière frappe compte.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { highlightSegments, parseHeadline, resultHref, searchTerms, type SearchHit, type Segment } from "@/lib/search";

type Outcome = { key: string; results: SearchHit[] } | { key: string; error: string };

export function SearchBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const terms = useMemo(() => searchTerms(query), [query]);
  // Les mots pliés font la clé : « École » puis « ecole » ne relancent rien.
  const key = terms.join(" ");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (response.status === 401) return setOutcome({ key, error: "Session expirée : reconnectez-vous." });
        if (!response.ok) return setOutcome({ key, error: `Recherche impossible (${response.status}).` });
        const data = (await response.json()) as { results: SearchHit[] };
        setOutcome({ key, results: data.results });
      } catch {
        if (!controller.signal.aborted) setOutcome({ key, error: "Connexion perdue : recherche impossible." });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  // Pendant la frappe, les résultats précédents restent affichés.
  const loading = key !== "" && outcome?.key !== key;

  return (
    <>
      <div className="search-field" role="search">
        <input
          type="search"
          value={query}
          placeholder="Rechercher"
          aria-label="Rechercher dans les pages"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>
      {key ? (
        <nav className="search-results" aria-label="Résultats de recherche" aria-busy={loading}>
          <Results outcome={outcome} loading={loading} query={query} terms={terms} pathname={pathname} />
        </nav>
      ) : (
        children
      )}
    </>
  );
}

type ResultsProps = { outcome: Outcome | null; loading: boolean; query: string; terms: string[]; pathname: string };

function Results({ outcome, loading, query, terms, pathname }: ResultsProps) {
  if (outcome && "error" in outcome) {
    return (
      <p className="sidebar-message" role="alert">
        {outcome.error}
      </p>
    );
  }
  if (!outcome || (loading && outcome.results.length === 0)) return <p className="search-status">Recherche…</p>;
  if (outcome.results.length === 0) {
    return (
      <p className="search-status" role="status">
        Rien trouvé pour <em>{query.trim()}</em>.
      </p>
    );
  }
  const count = outcome.results.length;
  return (
    <>
      <p className="search-status" role="status">
        {count === 1 ? "1 résultat" : `${count} résultats`}
      </p>
      <ul>
        {outcome.results.map((hit) => {
          const href = resultHref(hit, outcome.key);
          const active = pathname === href.split("?")[0];
          return (
            <li key={hit.id}>
              <Link href={href} className={active ? "search-hit active" : "search-hit"}>
                <span className="search-hit-title">
                  {hit.icon ?? (hit.type === "database" ? "🗃️" : "📄")}{" "}
                  {hit.title ? <Highlighted segments={highlightSegments(hit.title, terms)} /> : "Sans titre"}
                </span>
                <Excerpt raw={hit.excerpt} />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Highlighted({ segments }: { segments: Segment[] }) {
  return segments.map((segment, i) =>
    segment.hit ? (
      <mark key={i} className="hit">
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}

function Excerpt({ raw }: { raw: string }) {
  const segments = parseHeadline(raw);
  if (!segments.length) return null;
  return (
    <span className="search-hit-excerpt">
      <Highlighted segments={segments} />
    </span>
  );
}
