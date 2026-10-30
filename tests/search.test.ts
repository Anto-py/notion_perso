import { describe, expect, it } from "vitest";
import {
  HIT_END,
  HIT_START,
  fold,
  highlightRanges,
  highlightSegments,
  parseHeadline,
  resultHref,
  searchTerms,
} from "@/lib/search";

describe("searchTerms", () => {
  it("plie casse, accents et ligatures", () => {
    expect(searchTerms("Évaluation ŒUVRE")).toEqual(["evaluation", "oeuvre"]);
  });

  it("ne garde que lettres et chiffres, aucune syntaxe ne passe", () => {
    expect(searchTerms("chat & !chien:* | 'x' 2026")).toEqual(["chat", "chien", "2026"]);
  });

  it("écarte les mots d'un caractère et les doublons", () => {
    expect(searchTerms("l'école l'Ecole")).toEqual(["ecole"]);
    expect(searchTerms("a")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("borne le nombre de mots", () => {
    expect(searchTerms("aa bb cc dd ee ff gg hh ii jj")).toHaveLength(8);
  });
});

describe("fold", () => {
  it("relie chaque caractère plié à son origine", () => {
    const { folded, origin } = fold("Œil é");
    expect(folded).toBe("oeil e");
    expect(origin).toEqual([0, 0, 1, 2, 3, 4]);
  });
});

describe("parseHeadline", () => {
  it("découpe l'extrait selon les marqueurs", () => {
    expect(parseHeadline(`grille d'${HIT_START}évaluation${HIT_END} pour`)).toEqual([
      { text: "grille d'", hit: false },
      { text: "évaluation", hit: true },
      { text: " pour", hit: false },
    ]);
  });

  it("réduit les retours à la ligne et les espaces de bord", () => {
    expect(parseHeadline(`\n un\n\ndeux `)).toEqual([{ text: "un deux", hit: false }]);
  });

  it("tolère un marqueur orphelin", () => {
    expect(parseHeadline(`a${HIT_END}b${HIT_START}c`)).toEqual([
      { text: "a", hit: false },
      { text: "b", hit: false },
      { text: "c", hit: true },
    ]);
  });

  it("rend une liste vide pour un extrait vide", () => {
    expect(parseHeadline("")).toEqual([]);
  });
});

describe("highlightRanges", () => {
  it("surligne le mot entier dont le début correspond, accents ignorés", () => {
    const text = "Les évaluations, l'Évaluation";
    expect(highlightRanges(text, ["eval"]).map(([s, e]) => text.slice(s, e))).toEqual(["évaluations", "Évaluation"]);
  });

  it("ne prend pas un terme au milieu d'un mot", () => {
    expect(highlightRanges("réévaluation", ["eval"])).toEqual([]);
  });

  it("reporte les indices sur le texte d'origine malgré une ligature", () => {
    const text = "Une œuvre";
    const [[start, end]] = highlightRanges(text, ["oeuvre"]);
    expect(text.slice(start, end)).toBe("œuvre");
  });

  it("garde le bon indice après un caractère hors plan de base", () => {
    const text = "🙂 école";
    const [[start, end]] = highlightRanges(text, ["eco"]);
    expect(text.slice(start, end)).toBe("école");
  });
});

describe("highlightSegments", () => {
  it("alterne texte et mots trouvés", () => {
    expect(highlightSegments("Grille d'évaluation", ["eval"])).toEqual([
      { text: "Grille d'", hit: false },
      { text: "évaluation", hit: true },
    ]);
  });

  it("rend le texte entier quand rien ne correspond", () => {
    expect(highlightSegments("Yo", ["eval"])).toEqual([{ text: "Yo", hit: false }]);
  });
});

describe("resultHref", () => {
  it("ouvre une page avec le terme à surligner", () => {
    expect(resultHref({ id: "pg_a", type: "entry", isInbox: false }, " école ")).toBe("/page/pg_a?q=%C3%A9cole");
  });

  it("ouvre une base sur sa vue, le Vide-cerveau sur /inbox", () => {
    expect(resultHref({ id: "pg_b", type: "database", isInbox: false }, "x")).toBe("/db/pg_b");
    expect(resultHref({ id: "pg_c", type: "database", isInbox: true }, "x")).toBe("/inbox");
  });
});
