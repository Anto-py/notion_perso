import { describe, expect, it } from "vitest";
import { linkedViewHtml } from "@/lib/linked_html";
import type { EntryRow, Property } from "@/lib/properties";
import { EMPTY_VISITOR, applyVisitor, presentOptions, publicDatabaseData, relationChoices, visitorFilterable } from "@/lib/public_view";
import { sanitizeView } from "@/lib/views";

const statut: Property = {
  id: "prop_statut",
  name: "Statut",
  type: "select",
  options: [
    { id: "opt_fait", name: "Fait", color: "green" },
    { id: "opt_a_faire", name: "À faire", color: "gray" },
    { id: "opt_abandon", name: "Abandonné", color: "red" },
  ],
};
const note: Property = { id: "prop_note", name: "Note privée", type: "text" };
const lieux: Property = { id: "prop_lieux", name: "Lieux", type: "relation", target: "db_lieux" };
const cree: Property = { id: "prop_cree", name: "Créé le", type: "created_time" };

const entry = (patch: Partial<EntryRow> = {}): EntryRow => ({
  id: "entry_a",
  title: "École du lundi",
  icon: null,
  values: {},
  manualOrder: "a0",
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-02T09:00:00.000Z",
  ...patch,
});

const links = { href: (id: string) => `/p/pub/${id}`, chip: (ref: { id: string }) => (ref.id === "lieu_public" ? `/p/pub/${ref.id}` : null), mediaBase: "/api/media/" };

// Vue tableau qui masque la note et filtre sur elle : ni la valeur ni le
// filtre ne doivent partir vers le navigateur.
const view = sanitizeView(
  { id: "view_a", kind: "table", hidden: [note.id], filters: [{ prop: note.id, op: "contains", value: "secret" }] },
  [statut, note, lieux, cree],
);

const rows = [
  entry({
    id: "e1",
    title: "École du lundi",
    values: { [statut.id]: "opt_fait", [note.id]: "secret 1", [lieux.id]: ["lieu_public"] },
    links: {
      [lieux.id]: [{ id: "lieu_public", title: "Bruxelles", icon: null, trashed: false, publicBaseId: null }],
      [note.id]: [],
    },
  }),
  entry({
    id: "e2",
    title: "Atelier IA",
    values: { [statut.id]: "opt_a_faire", [note.id]: "secret 2", [lieux.id]: ["lieu_prive"] },
    links: { [lieux.id]: [{ id: "lieu_prive", title: "Anvers", icon: null, trashed: false, publicBaseId: null }] },
  }),
  entry({ id: "e3", title: "ecole du mardi", values: { [statut.id]: "opt_fait" } }),
];

describe("publicDatabaseData", () => {
  const data = publicDatabaseData(rows, [statut, note, lieux, cree], view, links);

  it("ne garde que les colonnes affichées, sans valeur masquée ni filtre de la vue", () => {
    expect(data.columns.map((prop) => prop.id)).toEqual([statut.id, lieux.id, cree.id]);
    const payload = JSON.stringify(data);
    expect(payload).not.toContain("secret");
    expect(payload).not.toContain(note.id);
    expect(data.view).toEqual({
      kind: "table",
      cardSize: "medium",
      showTitle: true,
      frozenFirstColumn: false,
      frozenHeader: false,
    });
  });

  it("calcule les liens côté serveur : entrées, puces publiques, puces privées sans lien", () => {
    expect(data.entryHref).toEqual({ e1: "/p/pub/e1", e2: "/p/pub/e2", e3: "/p/pub/e3" });
    expect(data.chipHref).toEqual({ lieu_public: "/p/pub/lieu_public", lieu_prive: null });
  });

  it("numérote l'ordre de la vue, et ne garde l'horodatage que si une colonne l'affiche", () => {
    expect(data.entries.map((row) => row.manualOrder)).toEqual(["000000", "000001", "000002"]);
    expect(data.entries[0].createdAt).toBe("2026-11-01T09:00:00.000Z");
    expect(data.entries[0].updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("une galerie n'envoie ni propriété ni valeur, seulement images et titres", () => {
    const gallery = sanitizeView({ id: "view_g", kind: "gallery" }, [statut, note]);
    const shaped = publicDatabaseData([entry({ values: { [note.id]: "secret" }, bodyImage: "/api/media/up_x.png" })], [statut, note], gallery, links);
    expect(shaped.columns).toEqual([]);
    expect(shaped.entries[0].values).toEqual({});
    expect(shaped.entries[0].bodyImage).toBe("/api/media/up_x.png");
  });

  it("transmet le figeage réglé sur la vue publiée", () => {
    const frozen = sanitizeView({ id: "view_f", kind: "table", frozen_first_column: true, frozen_header: true }, [statut, note]);
    const shaped = publicDatabaseData(rows, [statut, note], frozen, links);
    expect(shaped.view.frozenFirstColumn).toBe(true);
    expect(shaped.view.frozenHeader).toBe(true);
  });
});

describe("applyVisitor", () => {
  const data = publicDatabaseData(rows, [statut, note, lieux, cree], view, links);

  it("sans geste, rend l'ordre de la vue", () => {
    expect(applyVisitor(data.entries, data.columns, EMPTY_VISITOR).map((row) => row.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("cherche par le titre sans tenir compte des accents ni de la casse", () => {
    expect(applyVisitor(data.entries, data.columns, { ...EMPTY_VISITOR, query: " ÉCOLE " }).map((row) => row.id)).toEqual(["e1", "e3"]);
  });

  it("ajoute ses filtres les uns aux autres, relation comprise", () => {
    const state = {
      ...EMPTY_VISITOR,
      filters: [
        { prop: statut.id, op: "is" as const, value: "opt_fait" },
        { prop: lieux.id, op: "contains" as const, value: "lieu_public" },
      ],
    };
    expect(applyVisitor(data.entries, data.columns, state).map((row) => row.id)).toEqual(["e1"]);
  });

  it("ignore un filtre sur une colonne qui n'a pas voyagé", () => {
    const state = { ...EMPTY_VISITOR, filters: [{ prop: note.id, op: "contains" as const, value: "secret 1" }] };
    expect(applyVisitor(data.entries, data.columns, state)).toHaveLength(3);
  });

  it("trie, puis départage par l'ordre de la vue", () => {
    const state = { ...EMPTY_VISITOR, sorts: [{ prop: statut.id, dir: "desc" as const }] };
    // À faire (rang 1 des options) avant Fait (rang 0) ; e1 reste avant e3.
    expect(applyVisitor(data.entries, data.columns, state).map((row) => row.id)).toEqual(["e2", "e1", "e3"]);
    const byTitle = { ...EMPTY_VISITOR, sorts: [{ prop: "title", dir: "asc" as const }] };
    // Accents et casse ignorés : « École du lundi » avant « ecole du mardi ».
    expect(applyVisitor(data.entries, data.columns, byTitle).map((row) => row.id)).toEqual(["e2", "e1", "e3"]);
  });
});

describe("choix des filtres du visiteur", () => {
  const data = publicDatabaseData(rows, [statut, note, lieux, cree], view, links);

  it("propose le titre puis les colonnes affichées", () => {
    expect(visitorFilterable(data.columns).map((prop) => prop.id)).toEqual(["title", statut.id, lieux.id, cree.id]);
  });

  it("propose les puces présentes, triées par titre", () => {
    expect(relationChoices(data.entries, lieux)).toEqual([
      { id: "lieu_prive", title: "Anvers" },
      { id: "lieu_public", title: "Bruxelles" },
    ]);
  });

  it("propose les options présentes, dans l'ordre du schéma", () => {
    expect(presentOptions(data.entries, statut).map((option) => option.id)).toEqual(["opt_fait", "opt_a_faire"]);
  });
});

describe("linkedViewHtml et l'îlot", () => {
  it("pose la clé de l'îlot et isole la partie qu'il remplace", () => {
    const html = linkedViewHtml({ title: "To-do", icon: null }, [entry()], [statut], sanitizeView({ id: "v" }, [statut]), {
      href: (id) => id,
      islandKey: "linked-0",
    });
    expect(html).toMatch(/^<div class="linked-block" data-key="linked-0"><p class="linked-head">/);
    expect(html).toContain('<div class="linked-static"><div class="table-wrap">');
  });

  it("sans clé, l'encart reste tel qu'avant", () => {
    const html = linkedViewHtml({ title: "To-do", icon: null }, [entry()], [statut], sanitizeView({ id: "v" }, [statut]), { href: (id) => id });
    expect(html).not.toContain("data-key");
  });
});
