import { describe, expect, it } from "vitest";
import { blockIdFromHash, blockLinkUrl, hasBlockId, isBlockId, pickRelocated, withBlockId } from "@/lib/block_link";

const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("isBlockId", () => {
  it("accepte un UUID et les identifiants sûrs", () => {
    expect(isBlockId(UUID)).toBe(true);
    expect(isBlockId("b_1-A")).toBe(true);
  });

  it("refuse le vide, les caractères d'attribut ou de sélecteur et l'excès de longueur", () => {
    expect(isBlockId("")).toBe(false);
    expect(isBlockId('a"b')).toBe(false);
    expect(isBlockId("a b")).toBe(false);
    expect(isBlockId("a]b")).toBe(false);
    expect(isBlockId("x".repeat(65))).toBe(false);
    expect(isBlockId(42)).toBe(false);
    expect(isBlockId(undefined)).toBe(false);
  });
});

describe("blockLinkUrl", () => {
  it("assemble origine, page et ancre", () => {
    expect(blockLinkUrl("https://notion.example.eu", "pg_1", UUID)).toBe(`https://notion.example.eu/page/pg_1#${UUID}`);
  });

  it("retire les barres finales de l'origine (SYNC_REMOTE_URL en porte parfois)", () => {
    expect(blockLinkUrl("https://notion.example.eu/", "pg_1", "b1")).toBe("https://notion.example.eu/page/pg_1#b1");
    expect(blockLinkUrl("https://notion.example.eu///", "pg_1", "b1")).toBe("https://notion.example.eu/page/pg_1#b1");
  });

  it("sans origine, rend une adresse relative", () => {
    expect(blockLinkUrl("", "pg_1", "b1")).toBe("/page/pg_1#b1");
  });
});

describe("blockIdFromHash", () => {
  it("lit l'identifiant derrière le #", () => {
    expect(blockIdFromHash(`#${UUID}`)).toBe(UUID);
  });

  it("rend null sans ancre, avec une ancre vide ou étrangère à un bloc", () => {
    expect(blockIdFromHash("")).toBeNull();
    expect(blockIdFromHash("#")).toBeNull();
    expect(blockIdFromHash("#a b")).toBeNull();
    expect(blockIdFromHash("#a%22b")).toBeNull();
  });

  it("ne plante pas sur un pourcentage mal formé", () => {
    expect(blockIdFromHash("#%E0%A4%A")).toBeNull();
  });
});

describe("hasBlockId", () => {
  const body = [
    { id: "a", type: "paragraph", content: [], children: [{ id: "b", type: "paragraph", children: [] }] },
    { id: "c", type: "columnList", children: [{ id: "d", type: "column", children: [{ id: "e", type: "paragraph", children: [] }] }] },
  ];

  it("trouve un bloc de premier niveau, un enfant et un bloc dans une colonne", () => {
    expect(hasBlockId(body, "a")).toBe(true);
    expect(hasBlockId(body, "b")).toBe(true);
    expect(hasBlockId(body, "e")).toBe(true);
  });

  it("rend false pour un bloc absent, un corps vide ou une forme inattendue", () => {
    expect(hasBlockId(body, "z")).toBe(false);
    expect(hasBlockId([], "a")).toBe(false);
    expect(hasBlockId(null, "a")).toBe(false);
    expect(hasBlockId("texte", "a")).toBe(false);
  });
});

describe("pickRelocated", () => {
  it("choisit la page modifiée en dernier", () => {
    const rows = [
      { id: "p1", updatedAt: "2026-11-01T10:00:00.000Z" },
      { id: "p2", updatedAt: "2026-11-12T10:00:00.000Z" },
      { id: "p3", updatedAt: "2026-11-05T10:00:00.000Z" },
    ];
    expect(pickRelocated(rows, "autre")).toBe("p2");
  });

  it("ignore la page où le bloc manque déjà", () => {
    const rows = [
      { id: "courante", updatedAt: "2026-11-12T10:00:00.000Z" },
      { id: "p1", updatedAt: "2026-11-01T10:00:00.000Z" },
    ];
    expect(pickRelocated(rows, "courante")).toBe("p1");
  });

  it("rend null sans candidat", () => {
    expect(pickRelocated([], "courante")).toBeNull();
    expect(pickRelocated([{ id: "courante", updatedAt: "2026-11-12T10:00:00.000Z" }], "courante")).toBeNull();
  });

  it("accepte des dates en objet Date ou en millisecondes", () => {
    const rows = [
      { id: "p1", updatedAt: new Date("2026-11-01T10:00:00Z") },
      { id: "p2", updatedAt: Date.parse("2026-11-09T10:00:00Z") },
    ];
    expect(pickRelocated(rows, "x")).toBe("p2");
  });
});

describe("withBlockId", () => {
  it("pose l'id sur la première balise ouvrante", () => {
    expect(withBlockId("<p>Bonjour</p>", "b1")).toBe('<p id="b1">Bonjour</p>');
  });

  it("garde les attributs existants", () => {
    expect(withBlockId('<h2 class="align-center">Titre</h2>', "b1")).toBe('<h2 id="b1" class="align-center">Titre</h2>');
  });

  it("gère une balise sans contenu", () => {
    expect(withBlockId("<hr>", "b1")).toBe('<hr id="b1">');
  });

  it("n'ajoute l'id qu'à la première balise, pas aux suivantes", () => {
    expect(withBlockId('<p>a</p><div class="block-children"><p>b</p></div>', "b1")).toBe(
      '<p id="b1">a</p><div class="block-children"><p>b</p></div>',
    );
  });

  it("laisse intact un HTML vide, sans balise en tête, ou un id douteux", () => {
    expect(withBlockId("", "b1")).toBe("");
    expect(withBlockId("texte nu", "b1")).toBe("texte nu");
    expect(withBlockId("<p>x</p>", 'a"b')).toBe("<p>x</p>");
  });
});
