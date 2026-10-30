import { describe, expect, it } from "vitest";
import { appendOrphans, flattenToText } from "@/lib/blocks";

describe("flattenToText", () => {
  it("aplatit titres, paragraphes et liens, un bloc par ligne", () => {
    const body = [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Idée clé", styles: {} }], children: [] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Voir ", styles: {} },
          { type: "link", href: "https://ex.be", content: [{ type: "text", text: "l'article", styles: {} }] },
        ],
        children: [],
      },
    ];
    expect(flattenToText(body)).toBe("Idée clé\nVoir l'article");
  });

  it("descend dans les blocs enfants", () => {
    const body = [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "parent", styles: {} }],
        children: [{ type: "bulletListItem", content: [{ type: "text", text: "enfant", styles: {} }], children: [] }],
      },
    ];
    expect(flattenToText(body)).toBe("parent\nenfant");
  });

  it("garde le nom et la légende d'un fichier, pour la recherche", () => {
    const body = [{ type: "file", props: { name: "grille.pdf", caption: "Grille d'évaluation", url: "/api/media/x" } }];
    expect(flattenToText(body)).toBe("grille.pdf\nGrille d'évaluation");
  });

  it("lit les cellules d'un tableau", () => {
    const body = [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[{ type: "text", text: "a", styles: {} }], { type: "tableCell", content: [{ type: "text", text: "b", styles: {} }] }] }],
        },
      },
    ];
    expect(flattenToText(body)).toBe("a\nb");
  });

  it("ignore sans planter ce qui n'est pas un corps de blocs", () => {
    expect(flattenToText(null)).toBe("");
    expect(flattenToText("texte")).toBe("");
    expect(flattenToText([null, 3, { type: "paragraph", content: [{ type: "mystère" }] }])).toBe("");
  });
});

describe("appendOrphans", () => {
  it("ajoute un paragraphe par valeur, le lien restant cliquable", () => {
    const body = appendOrphans(
      [{ type: "paragraph", content: [{ type: "text", text: "Note existante", styles: {} }], children: [] }],
      [
        { name: "URL", type: "url", text: "https://exemple.org" },
        { name: "Source", type: "text", text: "Exemple" },
      ],
    );
    expect(body).toHaveLength(3);
    expect(body[1]).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "URL : " },
        { type: "link", href: "https://exemple.org", content: [{ type: "text", text: "https://exemple.org" }] },
      ],
    });
    expect(flattenToText(body)).toBe("Note existante\nURL : https://exemple.org\nSource : Exemple");
  });

  it("part d'un corps vide quand il n'y en a pas", () => {
    expect(appendOrphans(null, [{ name: "Aperçu", type: "text", text: "Une phrase" }])).toHaveLength(1);
  });
});
