import { describe, expect, it } from "vitest";
import { emptyVitrineState, facetCounts, slugify, vitrineView, type VitrineEntry } from "@/lib/vitrine";
import type { VitrineSearch } from "@/lib/vitrine_search";
import {
  activeFilters,
  applySuggestion,
  clearAll,
  ficheFromHref,
  findFiche,
  menuValue,
  resolveFiche,
  resultsTitle,
  searchKey,
  searchPool,
  sheetNeighbors,
  shownSearch,
  toggleCoeur,
  toggleFacet,
  vitrineHref,
} from "@/lib/vitrine_state";

function entry(partial: Partial<VitrineEntry> & { id: string; title: string }): VitrineEntry {
  return {
    slug: slugify(partial.title),
    icon: null,
    logo: null,
    description: "",
    domaines: [],
    niveau: null,
    prix: [],
    type: [],
    site: null,
    siteKey: null,
    coeur: false,
    nouveau: false,
    hasNotes: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const ENTRIES = [
  entry({ id: "a", title: "Mindmup", domaines: ["Mind map"], prix: ["Gratuit"] }),
  entry({ id: "b", title: "Wooclap", domaines: ["IA", "Quiz / exerciseurs"], prix: ["Freemium"], coeur: true }),
  entry({ id: "c", title: "Padlet", domaines: ["IA"] }),
];

const SEARCH: VitrineSearch = {
  query: "quiz",
  mode: "tous_les_mots",
  total: 1,
  results: [{ slug: "wooclap", matchedIn: "domaine", snippet: null }],
};

describe("toggleFacet", () => {
  it("ajoute puis retire un slug sans toucher aux autres familles ni à la fiche", () => {
    const start = { ...emptyVitrineState(), prix: ["gratuit"], fiche: "mindmup" };
    const on = toggleFacet(start, "domaine", "ia");
    expect(on.domaine).toEqual(["ia"]);
    expect(on.prix).toEqual(["gratuit"]);
    expect(on.fiche).toBe("mindmup");
    expect(toggleFacet(on, "domaine", "ia").domaine).toEqual([]);
    expect(start.domaine).toEqual([]);
  });
});

describe("toggleCoeur et clearAll", () => {
  it("bascule les coups de cœur", () => {
    expect(toggleCoeur(emptyVitrineState()).coeur).toBe(true);
    expect(toggleCoeur(toggleCoeur(emptyVitrineState())).coeur).toBe(false);
  });

  it("efface recherche, filtres et coups de cœur, garde la fiche", () => {
    const busy = { ...emptyVitrineState(), q: "quiz", domaine: ["ia"], type: ["non-precise"], coeur: true, fiche: "padlet" };
    expect(clearAll(busy)).toEqual({ ...emptyVitrineState(), fiche: "padlet" });
  });
});

describe("applySuggestion", () => {
  it("vide la recherche et ajoute le domaine, sans doublon", () => {
    const state = { ...emptyVitrineState(), q: "colaboration tablo", domaine: ["ia"] };
    expect(applySuggestion(state, "collaboration")).toMatchObject({ q: "", domaine: ["ia", "collaboration"] });
    expect(applySuggestion(state, "ia").domaine).toEqual(["ia"]);
  });
});

describe("activeFilters", () => {
  it("rend les filtres dans l'ordre des familles avec leur libellé, coups de cœur en dernier", () => {
    const state = { ...emptyVitrineState(), prix: ["gratuit"], domaine: ["ia"], niveau: ["non-precise"], coeur: true };
    const chips = activeFilters(state, facetCounts(ENTRIES, state));
    expect(chips).toEqual([
      { family: "domaine", slug: "ia", label: "IA" },
      { family: "niveau", slug: "non-precise", label: "Non précisé" },
      { family: "prix", slug: "gratuit", label: "Gratuit" },
      { family: "coeur", slug: "1", label: "★ Coups de cœur" },
    ]);
  });

  it("ne rend rien sans filtre ; la recherche seule n'est pas un filtre", () => {
    const state = { ...emptyVitrineState(), q: "quiz" };
    expect(activeFilters(state, facetCounts(ENTRIES, state))).toEqual([]);
  });
});

describe("searchKey et shownSearch", () => {
  it("une requête de moins de deux caractères utiles n'appelle pas le serveur", () => {
    expect(searchKey("q")).toBe("");
    expect(searchKey("  q  ")).toBe("");
    expect(searchKey("  quiz ")).toBe("quiz");
  });

  it("garde la dernière recherche revenue tant que la nouvelle n'est pas là", () => {
    const settled = { q: "quiz", search: SEARCH };
    expect(shownSearch("quiz tab", settled)).toBe(settled);
  });

  it("revient à la vitrine dès qu'il reste une lettre, sans attendre le serveur", () => {
    expect(shownSearch("q", { q: "quiz", search: SEARCH })).toEqual({ q: "q", search: null });
  });
});

describe("searchPool", () => {
  it("restreint aux entrées trouvées, toutes sans recherche", () => {
    expect(searchPool(ENTRIES, SEARCH).map((e) => e.id)).toEqual(["b"]);
    expect(searchPool(ENTRIES, null)).toBe(ENTRIES);
  });
});

describe("resultsTitle", () => {
  it("nomme la rangée selon le mode de recherche", () => {
    expect(resultsTitle(4, null)).toBe("Résultats (4)");
    expect(resultsTitle(4, "tous_les_mots")).toBe("Résultats (4)");
    expect(resultsTitle(2, "approchant")).toBe("Résultats approchants (2)");
  });
});

describe("vitrineHref", () => {
  it("rend l'adresse de l'état, nue pour la vitrine", () => {
    expect(vitrineHref(emptyVitrineState())).toBe("/veille");
    expect(vitrineHref({ ...emptyVitrineState(), q: "carte mentale", domaine: ["ia"] })).toBe("/veille?q=carte+mentale&domaine=ia");
  });
});

describe("findFiche et resolveFiche", () => {
  it("retrouve une entrée par slug ou par id", () => {
    expect(findFiche(ENTRIES, "wooclap")?.id).toBe("b");
    expect(findFiche(ENTRIES, "c")?.slug).toBe("padlet");
    expect(findFiche(ENTRIES, "inconnu")).toBeNull();
    expect(findFiche(ENTRIES, null)).toBeNull();
  });

  it("ramène un id au slug, écarte une fiche inconnue en le signalant", () => {
    const base = { ...emptyVitrineState(), domaine: ["ia"] };
    expect(resolveFiche({ ...base, fiche: "b" }, ENTRIES)).toEqual({ state: { ...base, fiche: "wooclap" }, missing: false });
    expect(resolveFiche({ ...base, fiche: "kahoot" }, ENTRIES)).toEqual({ state: { ...base, fiche: null }, missing: true });
    expect(resolveFiche(base, ENTRIES)).toEqual({ state: base, missing: false });
  });
});

describe("sheetNeighbors", () => {
  const vitrine = vitrineView(ENTRIES, emptyVitrineState(), null);

  it("suit la rangée d'origine, sans boucler en bout de rangée", () => {
    // Grille par titre : Mindmup, Padlet, Wooclap.
    expect(sheetNeighbors(vitrine, ENTRIES, "all", "padlet")).toEqual({ prev: "mindmup", next: "wooclap" });
    expect(sheetNeighbors(vitrine, ENTRIES, "all", "mindmup")).toEqual({ prev: null, next: "padlet" });
    // Coups de cœur : Wooclap seule.
    expect(sheetNeighbors(vitrine, ENTRIES, "coeur", "wooclap")).toEqual({ prev: null, next: null });
  });

  it("suit les résultats affichés, dans leur ordre", () => {
    const results = vitrineView(ENTRIES, { ...emptyVitrineState(), domaine: ["ia"] }, null);
    expect(sheetNeighbors(results, ENTRIES, "results", "padlet")).toEqual({ prev: null, next: "wooclap" });
    // Lien direct sur une adresse filtrée : la rangée affichée fait foi.
    expect(sheetNeighbors(results, ENTRIES, "all", "wooclap")).toEqual({ prev: "padlet", next: null });
  });

  it("retombe sur toutes les ressources quand la fiche n'est pas dans la rangée", () => {
    // Fiche atteinte par un lien des notes, hors des coups de cœur.
    expect(sheetNeighbors(vitrine, ENTRIES, "coeur", "padlet")).toEqual({ prev: "mindmup", next: "wooclap" });
  });
});

describe("ficheFromHref", () => {
  const origin = "https://notion.example.org";

  it("lit la fiche d'un lien de la vitrine, relatif ou absolu", () => {
    expect(ficheFromHref("/veille?fiche=wooclap", origin)).toBe("wooclap");
    expect(ficheFromHref(`${origin}/veille?fiche=padlet&domaine=ia`, origin)).toBe("padlet");
  });

  it("ignore tout autre lien", () => {
    expect(ficheFromHref("https://wooclap.com/?fiche=x", origin)).toBeNull();
    expect(ficheFromHref("/p/abc", origin)).toBeNull();
    expect(ficheFromHref("/veille?domaine=ia", origin)).toBeNull();
    expect(ficheFromHref("http://[mal", origin)).toBeNull();
  });
});

describe("menuValue", () => {
  const facet = (label: string, active: boolean) => ({ label, slug: slugify(label), count: 1, active });

  it("rien de coché : « tous »", () => {
    expect(menuValue([facet("Gratuit", false), facet("Payant", false)])).toBe("tous");
  });

  it("une ou deux valeurs : leurs noms, dans l'ordre du menu", () => {
    expect(menuValue([facet("Gratuit", true), facet("Payant", false)])).toBe("Gratuit");
    expect(menuValue([facet("Freemium", true), facet("Gratuit", false), facet("Payant", true)])).toBe("Freemium, Payant");
  });

  it("au-delà de deux : le nombre", () => {
    expect(menuValue([facet("A", true), facet("B", true), facet("C", true)])).toBe("3 choisis");
  });
});
