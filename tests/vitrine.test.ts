import { describe, expect, it } from "vitest";
import type { EntryRow, Property } from "@/lib/property_schema";
import {
  NON_PRECISE,
  allRow,
  applyFilters,
  assignSlugs,
  emptyVitrineState,
  facetCounts,
  heartRow,
  highlightTerms,
  initialColor,
  isNarrowed,
  panorama,
  parseVitrineState,
  recentRow,
  serializeVitrineState,
  siteKey,
  slugify,
  suggestLabels,
  toVitrineEntry,
  vitrineFields,
  vitrineRenderOptions,
  vitrineView,
  type VitrineEntry,
} from "@/lib/vitrine";

const NOW = Date.parse("2026-11-10T12:00:00Z");

const PROPS: Property[] = [
  { id: "p_desc", name: "Description", type: "text" },
  {
    id: "p_dom",
    name: "Domaine",
    type: "multiselect",
    options: [
      { id: "o_ia", name: "IA", color: "blue" },
      { id: "o_quiz", name: "Quiz / exerciseurs", color: "green" },
      { id: "o_mind", name: "Mind map", color: "pink" },
      { id: "o_vide", name: "Jamais portée", color: "gray" },
    ],
  },
  {
    id: "p_niv",
    name: "Niveau",
    type: "select",
    options: [{ id: "o_deb", name: "Débutant", color: "green" }],
  },
  {
    id: "p_prix",
    name: "Prix",
    type: "multiselect",
    options: [
      { id: "o_grat", name: "Gratuit", color: "green" },
      { id: "o_free", name: "Freemium", color: "yellow" },
    ],
  },
  { id: "p_type", name: "Type", type: "multiselect", options: [{ id: "o_util", name: "Utilitaire", color: "gray" }] },
  { id: "p_site", name: "Site Web", type: "url" },
  { id: "p_coeur", name: "Coup de coeur", type: "checkbox" },
  {
    id: "p_cat",
    name: "Catégorie",
    type: "select",
    options: [{ id: "o_pc", name: "Pas commencé", color: "gray" }],
  },
];

function row(id: string, title: string, values: EntryRow["values"], createdAt = "2026-01-01T00:00:00Z"): EntryRow {
  return { id, title, icon: null, values, manualOrder: "a0", createdAt, updatedAt: createdAt };
}

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

describe("vitrineFields", () => {
  it("trouve chaque champ par nom plié, ligatures comprises", () => {
    const fields = vitrineFields(PROPS);
    expect(fields.coeur?.id).toBe("p_coeur");
    expect(fields.domaines?.id).toBe("p_dom");
  });

  it("écarte une propriété du bon nom mais d'un autre type", () => {
    const props: Property[] = [{ id: "p_niv", name: "niveau", type: "text" }];
    expect(vitrineFields(props).niveau).toBeNull();
  });
});

describe("toVitrineEntry", () => {
  const fields = vitrineFields(PROPS);

  it("résout les libellés et ne sort jamais Catégorie", () => {
    const out = toVitrineEntry(
      row("e1", "Mindmup", {
        p_desc: "Cartes mentales",
        p_dom: ["o_mind", "o_inconnue"],
        p_niv: "o_deb",
        p_prix: ["o_free"],
        p_site: "https://www.mindmup.com/",
        p_coeur: true,
        p_cat: "o_pc",
      }),
      fields,
      { slug: "mindmup", hasNotes: true, now: NOW },
    );
    expect(out).toMatchObject({
      description: "Cartes mentales",
      domaines: ["Mind map"],
      niveau: "Débutant",
      prix: ["Freemium"],
      type: [],
      site: "https://www.mindmup.com/",
      siteKey: "mindmup.com",
      logo: "/api/veille/logo/mindmup.com",
      coeur: true,
      hasNotes: true,
    });
    expect(JSON.stringify(out)).not.toContain("Pas commencé");
    expect(JSON.stringify(out)).not.toContain("o_pc");
  });

  it("rend un champ vide pour une valeur absente ou de mauvais type", () => {
    const out = toVitrineEntry(
      row("e2", "Bizarre", { p_desc: 42, p_dom: "o_ia", p_niv: ["o_deb"], p_coeur: "oui" }),
      fields,
      { slug: "bizarre", hasNotes: false, now: NOW },
    );
    expect(out).toMatchObject({ description: "", domaines: [], niveau: null, coeur: false, site: null, logo: null });
  });

  it("rend tout vide quand la propriété manque à la base", () => {
    const out = toVitrineEntry(row("e3", "Seul", {}), vitrineFields([]), { slug: "seul", hasNotes: false, now: NOW });
    expect(out).toMatchObject({ description: "", domaines: [], niveau: null, prix: [], type: [], coeur: false });
  });

  it("marque « nouveau » sous 30 jours", () => {
    const opts = { slug: "x", hasNotes: false, now: NOW };
    expect(toVitrineEntry(row("a", "A", {}, "2026-11-01T00:00:00Z"), fields, opts).nouveau).toBe(true);
    expect(toVitrineEntry(row("b", "B", {}, "2026-09-01T00:00:00Z"), fields, opts).nouveau).toBe(false);
  });
});

describe("slugify et assignSlugs", () => {
  it("plie, ne garde que [a-z0-9-] et borne à 60", () => {
    expect(slugify("Quiz / exerciseurs")).toBe("quiz-exerciseurs");
    expect(slugify("Œuvres d'Éducation !")).toBe("oeuvres-d-education");
    expect(slugify("x".repeat(80))).toHaveLength(60);
    expect(slugify("???")).toBe("ressource");
  });

  it("numérote les collisions par ordre de création", () => {
    const slugs = assignSlugs([
      { id: "tard", title: "Kahoot", createdAt: "2026-05-01T00:00:00Z" },
      { id: "tot", title: "Kahoot!", createdAt: "2026-01-01T00:00:00Z" },
      { id: "milieu", title: "kahoot", createdAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(slugs.get("tot")).toBe("kahoot");
    expect(slugs.get("milieu")).toBe("kahoot-2");
    expect(slugs.get("tard")).toBe("kahoot-3");
  });

  it("ne réattribue pas un slug déjà pris par un titre", () => {
    const slugs = assignSlugs([
      { id: "a", title: "Kahoot 2", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", title: "Kahoot", createdAt: "2026-02-01T00:00:00Z" },
      { id: "c", title: "Kahoot", createdAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(slugs.get("c")).toBe("kahoot-3");
  });
});

describe("siteKey", () => {
  it("ignore schéma, www et / final", () => {
    expect(siteKey("https://www.mindmup.com/")).toBe("mindmup.com");
    expect(siteKey("mindmup.com")).toBe("mindmup.com");
    expect(siteKey("http://MindMup.com")).toBe("mindmup.com");
  });

  it("garde le chemin, jette requête et ancre", () => {
    expect(siteKey("https://padlet.com/antonin/mur/?ref=x#a")).toBe("padlet.com/antonin/mur");
  });

  it("rend null pour une adresse illisible", () => {
    expect(siteKey("")).toBeNull();
    expect(siteKey("pas une adresse")).toBeNull();
    expect(siteKey("ftp://exemple.org")).toBeNull();
  });
});

const POOL: VitrineEntry[] = [
  entry({ id: "1", title: "ChatGPT", domaines: ["IA"], prix: ["Freemium"], niveau: "Débutant" }),
  entry({ id: "2", title: "Wooclap", domaines: ["IA", "Quiz / exerciseurs"], prix: ["Gratuit"] }),
  entry({ id: "3", title: "Kahoot", domaines: ["Quiz / exerciseurs"], prix: ["Gratuit"], niveau: "Débutant" }),
  entry({ id: "4", title: "Mindmup", domaines: ["Mind map"], prix: ["Freemium"], coeur: true }),
];

describe("applyFilters", () => {
  it("OU dans une famille, ET entre familles", () => {
    const state = { ...emptyVitrineState(), domaine: ["ia", "quiz-exerciseurs"], prix: ["gratuit"] };
    expect(applyFilters(POOL, state).map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("« non-precise » prend les entrées sans valeur", () => {
    const state = { ...emptyVitrineState(), niveau: [NON_PRECISE] };
    expect(applyFilters(POOL, state).map((e) => e.id)).toEqual(["2", "4"]);
  });

  it("coup de cœur seul", () => {
    expect(applyFilters(POOL, { ...emptyVitrineState(), coeur: true }).map((e) => e.id)).toEqual(["4"]);
  });

  it("aucun filtre : tout passe", () => {
    expect(applyFilters(POOL, emptyVitrineState())).toHaveLength(4);
  });
});

describe("facetCounts", () => {
  it("compte une famille avec les filtres des autres seulement", () => {
    const facets = facetCounts(POOL, { ...emptyVitrineState(), domaine: ["ia"], prix: ["gratuit"] });
    const dom = Object.fromEntries(facets.domaine.map((f) => [f.slug, f.count]));
    expect(dom).toEqual({ ia: 1, "quiz-exerciseurs": 2, "mind-map": 0 });
    const prix = Object.fromEntries(facets.prix.map((f) => [f.slug, f.count]));
    expect(prix).toEqual({ freemium: 1, gratuit: 1 });
    expect(facets.domaine.find((f) => f.slug === "ia")?.active).toBe(true);
  });

  it("compte « Non précisé » et omet les étiquettes que personne ne porte", () => {
    const facets = facetCounts(POOL, emptyVitrineState());
    expect(facets.niveau).toEqual([
      { label: "Débutant", slug: "debutant", count: 2, active: false },
      { label: "Non précisé", slug: NON_PRECISE, count: 2, active: false },
    ]);
    expect(facets.domaine.map((f) => f.label)).not.toContain("Jamais portée");
    expect(facets.type).toEqual([{ label: "Non précisé", slug: NON_PRECISE, count: 4, active: false }]);
  });
});

describe("panorama", () => {
  it("12 premières par compte, puis le reste par ordre alphabétique", () => {
    const facets = Array.from({ length: 15 }, (_, i) => ({
      label: `É${String.fromCharCode(97 + i)}`,
      slug: `e${i}`,
      count: i,
      active: false,
    }));
    const { top, rest } = panorama(facets);
    expect(top).toHaveLength(12);
    expect(top[0].count).toBe(14);
    expect(rest.map((f) => f.count)).toEqual([0, 1, 2]);
  });

  it("à compte égal, ordre alphabétique", () => {
    const { top } = panorama([
      { label: "Vidéo", slug: "video", count: 3, active: false },
      { label: "Audio", slug: "audio", count: 3, active: false },
    ]);
    expect(top.map((f) => f.label)).toEqual(["Audio", "Vidéo"]);
  });
});

describe("rangées", () => {
  const entries = [
    entry({ id: "a", title: "Zotero", coeur: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" }),
    entry({ id: "b", title: "écrivain", coeur: true, createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }),
    entry({ id: "c", title: "Anki", createdAt: "2026-02-01T00:00:00Z" }),
  ];

  it("coups de cœur par dernière modification", () => {
    expect(heartRow(entries).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("récents par création, bornés à 12", () => {
    expect(recentRow(entries).map((e) => e.id)).toEqual(["b", "c", "a"]);
    const many = Array.from({ length: 20 }, (_, i) =>
      entry({ id: String(i), title: String(i), createdAt: new Date(NOW - i * 86_400_000).toISOString() }),
    );
    expect(recentRow(many)).toHaveLength(12);
    expect(recentRow(many)[0].id).toBe("0");
  });

  it("toutes par titre, en français", () => {
    expect(allRow(entries).map((e) => e.title)).toEqual(["Anki", "écrivain", "Zotero"]);
  });
});

describe("état d'adresse", () => {
  it("lit l'exemple du brainstorming et ignore l'inconnu", () => {
    const entries = [
      ...POOL,
      entry({ id: "5", title: "Wooclap bis", domaines: ["Ludification"] }),
    ];
    const params = new URLSearchParams(
      "q=quiz&domaine=ia&domaine=ludification&domaine=disparue&prix=gratuit&niveau=non-precise&fiche=wooclap&zut=1",
    );
    expect(parseVitrineState(params, entries)).toEqual({
      q: "quiz",
      domaine: ["ia", "ludification"],
      niveau: [NON_PRECISE],
      prix: ["gratuit"],
      type: [],
      coeur: false,
      fiche: "wooclap",
    });
  });

  it("accepte les searchParams de Next (valeurs en tableau)", () => {
    const state = parseVitrineState({ domaine: ["ia", "ia"], coeur: "1", q: undefined }, POOL);
    expect(state).toMatchObject({ domaine: ["ia"], coeur: true, q: "" });
  });

  it("aller-retour à l'identique", () => {
    const state = {
      q: "carte mentale",
      domaine: ["ia", "quiz-exerciseurs"],
      niveau: ["debutant"],
      prix: ["gratuit"],
      type: [],
      coeur: true,
      fiche: "mindmup",
    };
    const query = serializeVitrineState(state);
    expect(parseVitrineState(new URLSearchParams(query), POOL)).toEqual(state);
    expect(serializeVitrineState(emptyVitrineState())).toBe("");
  });

  it("coupe la recherche à 200 caractères", () => {
    expect(parseVitrineState({ q: "a".repeat(300) }, POOL).q).toHaveLength(200);
  });
});

describe("suggestLabels", () => {
  const labels = [
    { label: "Collaboration", slug: "collaboration", count: 9, active: false },
    { label: "Tableaux", slug: "tableaux", count: 4, active: false },
    { label: "IA", slug: "ia", count: 23, active: false },
    { label: "Vidéo", slug: "video", count: 2, active: false },
    { label: "Audio", slug: "audio", count: 0, active: false },
  ];

  it("tolère les fautes de frappe", () => {
    expect(suggestLabels("colaboration tablo", labels).map((l) => l.label)).toEqual(["Collaboration", "Tableaux"]);
  });

  it("à défaut, les trois plus fournies", () => {
    expect(suggestLabels("xyzzy", labels).map((l) => l.label)).toEqual(["IA", "Collaboration", "Tableaux"]);
  });
});

describe("highlightTerms", () => {
  it("surligne les mots qui commencent par un terme plié", () => {
    expect(highlightTerms("Outil de cartes mentales", "carte mentale")).toEqual([
      { text: "Outil de ", hit: false },
      { text: "cartes", hit: true },
      { text: " ", hit: false },
      { text: "mentales", hit: true },
    ]);
  });
});

describe("initialColor", () => {
  it("est stable et tirée de la palette des options", () => {
    expect(initialColor("Mindmup")).toBe(initialColor("Mindmup"));
    const colors = new Set(["Anki", "Bob", "Canva", "Diigo", "Edpuzzle", "Flip", "Genially"].map(initialColor));
    expect(colors.size).toBeGreaterThan(1);
    expect(colors.has("gray")).toBe(false);
  });
});

describe("isNarrowed", () => {
  it("une lettre ne resserre rien, deux oui", () => {
    expect(isNarrowed({ ...emptyVitrineState(), q: "m" })).toBe(false);
    expect(isNarrowed({ ...emptyVitrineState(), q: " m " })).toBe(false);
    expect(isNarrowed({ ...emptyVitrineState(), q: "mi" })).toBe(true);
  });

  it("un filtre ou les coups de cœur resserrent ; la fiche seule non", () => {
    expect(isNarrowed({ ...emptyVitrineState(), domaine: ["ia"] })).toBe(true);
    expect(isNarrowed({ ...emptyVitrineState(), coeur: true })).toBe(true);
    expect(isNarrowed({ ...emptyVitrineState(), fiche: "mindmup" })).toBe(false);
  });
});

describe("vitrineView", () => {
  const entries = [
    entry({ id: "a", title: "Zotero", domaines: ["IA"], coeur: true }),
    entry({ id: "b", title: "Anki", domaines: ["IA"], createdAt: "2026-05-01T00:00:00Z" }),
    entry({ id: "c", title: "Mindmup", domaines: ["Mind map"] }),
  ];

  it("base vide : vide, filtres compris", () => {
    expect(vitrineView([], emptyVitrineState(), null)).toEqual({ kind: "empty" });
    expect(vitrineView([], { ...emptyVitrineState(), domaine: ["ia"] }, null)).toEqual({ kind: "empty" });
  });

  it("sans resserrement : les trois rangées", () => {
    const view = vitrineView(entries, { ...emptyVitrineState(), q: "z" }, null);
    expect(view.kind).toBe("vitrine");
    if (view.kind !== "vitrine") return;
    expect(view.heart.map((e) => e.id)).toEqual(["a"]);
    expect(view.recent.map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(view.all.map((e) => e.title)).toEqual(["Anki", "Mindmup", "Zotero"]);
  });

  it("filtre sans recherche : résultats par titre", () => {
    const view = vitrineView(entries, { ...emptyVitrineState(), domaine: ["ia"] }, null);
    expect(view).toEqual({ kind: "results", results: [entries[1], entries[0]] });
  });

  it("recherche classée : ordre du serveur, croisé avec les filtres", () => {
    const state = { ...emptyVitrineState(), q: "outil", domaine: ["ia"] };
    const view = vitrineView(entries, state, ["mindmup", "zotero", "inconnu", "anki"]);
    expect(view).toEqual({ kind: "results", results: [entries[0], entries[1]] });
  });
});

describe("vitrineRenderOptions", () => {
  const options = vitrineRenderOptions([entry({ id: "pg_mind", title: "Mindmup", icon: "🧠" })]);

  it("une entrée de la vitrine mène à sa fiche", () => {
    expect(options.subpage?.("pg_mind")).toEqual({ href: "/veille?fiche=mindmup", title: "Mindmup", icon: "🧠", type: "entry" });
    expect(options.internal?.("pg_mind")).toBe("/veille?fiche=mindmup");
  });

  it("toute autre page reste privée, et aucune vue liée ne sort", () => {
    expect(options.subpage?.("pg_autre")).toBe("private");
    expect(options.internal?.("pg_autre")).toBeNull();
    expect(options.linked?.("pg_base", "{}")).toBeNull();
  });
});
