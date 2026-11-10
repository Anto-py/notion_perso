import { describe, expect, it } from "vitest";
import { readAgentValues, resolveAgentValues, toList } from "@/lib/agent_values";
import type { Property } from "@/lib/properties";

const PROPS: Property[] = [
  { id: "p_statut", name: "Statut", type: "select", options: [{ id: "o_faire", name: "À faire", color: "gray" }] },
  { id: "p_tags", name: "Étiquettes", type: "multiselect", options: [{ id: "o_a", name: "école", color: "blue" }] },
  { id: "p_date", name: "Échéance", type: "date" },
  { id: "p_ok", name: "Urgent", type: "checkbox" },
  { id: "p_n", name: "Durée", type: "number" },
  { id: "p_note", name: "Note", type: "text" },
  { id: "p_lien", name: "Adresse", type: "url" },
  { id: "p_rel", name: "Projet", type: "relation", target: "pg_projets" },
  { id: "p_cree", name: "Créé le", type: "created_time" },
  { id: "p_cumul", name: "Total", type: "rollup", relation: "p_rel", target: "p_n", calc: "sum" },
];

let counter = 0;
const makeId = (prefix: string) => `${prefix}_${++counter}`;

describe("toList", () => {
  it("accepte un tableau ou une chaîne à virgules", () => {
    expect(toList(["a", " b "])).toEqual(["a", "b"]);
    expect(toList("a, b,")).toEqual(["a", "b"]);
    expect(toList(3)).toBeNull();
  });
});

describe("resolveAgentValues", () => {
  it("convertit chaque type par son nom, sans accents ni casse", () => {
    counter = 0;
    const result = resolveAgentValues(
      PROPS,
      {
        statut: "a faire",
        ETIQUETTES: ["école", "IA"],
        echeance: "2026-11-12",
        urgent: "oui",
        duree: "1 234,5",
        note: "Une note",
        adresse: "https://exemple.org",
        projet: ["Linux"],
      },
      new Map([["p_rel", { ids: ["pg_p1"] }]]),
      makeId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual({
      p_statut: "o_faire",
      p_tags: ["o_a", "opt_1"],
      p_date: "2026-11-12",
      p_ok: true,
      p_n: 1234.5,
      p_note: "Une note",
      p_lien: "https://exemple.org",
      p_rel: ["pg_p1"],
    });
    expect(result.created).toEqual(["Étiquettes : IA"]);
    expect(result.properties.find((prop) => prop.id === "p_tags")?.options).toHaveLength(2);
  });

  it("crée une option inconnue avec sa couleur", () => {
    counter = 0;
    const result = resolveAgentValues(PROPS, { Statut: "En cours" }, new Map(), makeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.p_statut).toBe("opt_1");
    expect(result.created).toEqual(["Statut : En cours"]);
    const options = result.properties.find((prop) => prop.id === "p_statut")?.options ?? [];
    expect(options.map((option) => option.name)).toEqual(["À faire", "En cours"]);
  });

  it("efface une valeur vide", () => {
    const result = resolveAgentValues(PROPS, { Statut: "", Note: "  ", Urgent: "", Durée: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual({ p_statut: null, p_note: null, p_ok: null, p_n: null });
  });

  it("refuse une propriété inconnue, un type calculé ou une valeur invalide", () => {
    expect(resolveAgentValues(PROPS, { Inconnue: "x" })).toEqual({ ok: false, error: "Propriété inconnue : « Inconnue »" });
    expect(resolveAgentValues(PROPS, { "Créé le": "2026-11-11" })).toEqual({
      ok: false,
      error: "Créé le : propriété en lecture seule",
    });
    expect(resolveAgentValues(PROPS, { Total: "1" })).toEqual({ ok: false, error: "Total : propriété en lecture seule" });
    expect(resolveAgentValues(PROPS, { Échéance: "12/11/2026" })).toEqual({ ok: false, error: "Échéance : date invalide" });
    expect(resolveAgentValues(PROPS, { Durée: "beaucoup" })).toEqual({ ok: false, error: "Durée : nombre illisible « beaucoup »" });
    expect(resolveAgentValues(PROPS, { Urgent: "peut-être" })).toEqual({ ok: false, error: "Urgent : oui ou non attendu" });
  });

  it("résout une relation par les réponses, refuse un titre absent", () => {
    expect(resolveAgentValues(PROPS, { Projet: ["Linux"] }, new Map([["p_rel", { ids: ["pg_p1"] }]]))).toMatchObject({
      ok: true,
      values: { p_rel: ["pg_p1"] },
    });
    expect(
      resolveAgentValues(PROPS, { Projet: ["Linux"] }, new Map([["p_rel", { error: "Projet : aucune entrée « Linux »" }]])),
    ).toEqual({ ok: false, error: "Projet : aucune entrée « Linux »" });
    expect(resolveAgentValues(PROPS, { Projet: ["Linux"] })).toEqual({ ok: false, error: "Projet : relations non résolues" });
  });

  it("refuse une relation jumelle", () => {
    const twin: Property[] = [{ id: "p_twin", name: "Jumelle", type: "relation", twinOf: { db: "pg_b", prop: "p_rel" } }];
    expect(resolveAgentValues(twin, { Jumelle: ["Linux"] })).toEqual({
      ok: false,
      error: "Jumelle : propriété calculée, non modifiable",
    });
  });
});

describe("readAgentValues", () => {
  it("accepte scalaires et listes de chaînes, refuse le reste", () => {
    expect(readAgentValues({ a: "x", b: 2, c: true, d: ["x"] })).toEqual({ a: "x", b: 2, c: true, d: ["x"] });
    expect(readAgentValues({ a: { b: 1 } })).toBe("Valeur invalide pour « a »");
    expect(readAgentValues(["x"])).toBe("values invalide");
    expect(readAgentValues(null)).toEqual({});
  });
});
