// Recherche de la vitrine (étape 20), partie pure : mots cherchés et
// classement des correspondances lues par searchVitrine (vitrine_query.ts).
// Séparée de vitrine.ts, déjà au-delà du seuil de taille.
import { searchTerms } from "./search";
import { QUERY_MAX } from "./vitrine";

// Rang du premier champ où l'entrée contient un des mots : titre 1, domaine 2,
// description 3, corps 4.
export const MATCHED_IN = ["titre", "domaine", "description", "corps"] as const;
export type MatchedIn = (typeof MATCHED_IN)[number];
export type FieldRank = 1 | 2 | 3 | 4;

// Ligne lue par la requête : `found`, nombre de mots distincts trouvés dans
// l'un ou l'autre champ ; `snippet`, extrait marqué (HIT_START / HIT_END).
export type VitrineHit = { id: string; title: string; found: number; field: FieldRank; snippet: string | null };

export type VitrineSearchMode = "tous_les_mots" | "approchant";
export type VitrineSearchResult = { slug: string; matchedIn: MatchedIn; snippet: string | null };
export type VitrineSearch = { query: string; mode: VitrineSearchMode; total: number; results: VitrineSearchResult[] };

// Saisie coupée à 200 caractères ; ponctuation et opérateurs ne sont que des
// séparateurs (searchTerms ne garde que lettres et chiffres).
export function vitrineSearchTerms(raw: string): { query: string; terms: string[] } {
  const query = raw.slice(0, QUERY_MAX);
  return { query, terms: searchTerms(query) };
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// Toutes les entrées qui ont tous les mots ; à défaut, celles qui en ont au
// moins un (« Résultats approchants »). Puis rang du champ, puis titre.
export function rankVitrineHits(
  hits: readonly VitrineHit[],
  termCount: number,
  slugOf: ReadonlyMap<string, string>,
): Omit<VitrineSearch, "query"> {
  const known = hits.filter((hit) => hit.found > 0 && slugOf.has(hit.id));
  const complete = known.filter((hit) => hit.found >= termCount);
  const mode: VitrineSearchMode = complete.length || !known.length ? "tous_les_mots" : "approchant";
  const kept = mode === "tous_les_mots" ? complete : known;
  const results = [...kept]
    .sort((a, b) => a.field - b.field || collator.compare(a.title, b.title))
    .map((hit) => ({
      slug: slugOf.get(hit.id)!,
      matchedIn: MATCHED_IN[hit.field - 1],
      snippet: hit.field === 4 ? hit.snippet : null,
    }));
  return { mode, total: results.length, results };
}
