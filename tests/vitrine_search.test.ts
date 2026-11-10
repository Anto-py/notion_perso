import { describe, expect, it } from "vitest";
import { HIT_END, HIT_START } from "@/lib/search";
import { rankVitrineHits, vitrineSearchTerms, type VitrineHit } from "@/lib/vitrine_search";

const hit = (id: string, title: string, found: number, field: VitrineHit["field"], snippet: string | null = null): VitrineHit => ({
  id,
  title,
  found,
  field,
  snippet,
});

const slugs = new Map([
  ["e1", "mindmup"],
  ["e2", "mindmeister"],
  ["e3", "ayoa"],
  ["e4", "ecole-directe"],
  ["e5", "edpuzzle"],
]);

describe("vitrineSearchTerms", () => {
  it("coupe la saisie à 200 caractères sans erreur", () => {
    const { query } = vitrineSearchTerms("a".repeat(300));
    expect(query).toHaveLength(200);
  });

  it("traite ponctuation et opérateurs comme du texte", () => {
    expect(vitrineSearchTerms('"carte" -mentale: (tableau)').terms).toEqual(["carte", "mentale", "tableau"]);
  });

  it("plie accents et casse", () => {
    expect(vitrineSearchTerms("Réviser").terms).toEqual(["reviser"]);
  });
});

describe("rankVitrineHits", () => {
  it("garde les entrées qui ont tous les mots, en mode tous_les_mots", () => {
    const out = rankVitrineHits([hit("e1", "Mindmup", 2, 3), hit("e3", "Ayoa", 1, 2)], 2, slugs);
    expect(out.mode).toBe("tous_les_mots");
    expect(out.results.map((r) => r.slug)).toEqual(["mindmup"]);
  });

  it("passe en approchant quand aucune n'a tous les mots", () => {
    const out = rankVitrineHits([hit("e1", "Mindmup", 1, 3), hit("e3", "Ayoa", 2, 2)], 3, slugs);
    expect(out.mode).toBe("approchant");
    expect(out.results.map((r) => r.slug)).toEqual(["ayoa", "mindmup"]);
  });

  it("classe titre, domaine, description, corps, puis par titre à rang égal", () => {
    const out = rankVitrineHits(
      [hit("e2", "Mindmeister", 1, 3), hit("e5", "Edpuzzle", 1, 4), hit("e1", "Mindmup", 1, 1), hit("e3", "Ayoa", 1, 3), hit("e4", "École directe", 1, 2)],
      1,
      slugs,
    );
    expect(out.results.map((r) => [r.slug, r.matchedIn])).toEqual([
      ["mindmup", "titre"],
      ["ecole-directe", "domaine"],
      ["ayoa", "description"],
      ["mindmeister", "description"],
      ["edpuzzle", "corps"],
    ]);
  });

  it("ne garde l'extrait que lorsque le corps est le premier champ trouvé", () => {
    const marked = `… pour ${HIT_START}réviser${HIT_END} en classe …`;
    const out = rankVitrineHits([hit("e5", "Edpuzzle", 1, 4, marked), hit("e1", "Mindmup", 1, 1, "ignoré")], 1, slugs);
    expect(out.results).toEqual([
      { slug: "mindmup", matchedIn: "titre", snippet: null },
      { slug: "edpuzzle", matchedIn: "corps", snippet: marked },
    ]);
  });

  it("écarte une entrée sans slug (créée entre deux lectures) et compte le total", () => {
    const out = rankVitrineHits([hit("inconnue", "Zzz", 1, 1), hit("e1", "Mindmup", 1, 1)], 1, slugs);
    expect(out).toEqual({ mode: "tous_les_mots", total: 1, results: [{ slug: "mindmup", matchedIn: "titre", snippet: null }] });
  });

  it("sans aucune correspondance, reste en tous_les_mots avec zéro résultat", () => {
    expect(rankVitrineHits([], 2, slugs)).toEqual({ mode: "tous_les_mots", total: 0, results: [] });
  });
});
