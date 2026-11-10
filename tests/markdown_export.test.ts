import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  databaseToMarkdown,
  entryValues,
  escapeMarkdown,
  frontMatter,
  inlineMarkdown,
  yamlString,
} from "@/lib/markdown_export";
import { markdownToBlocks, type MarkdownContext } from "@/lib/notion-markdown";
import type { EntryRow, Property } from "@/lib/properties";

function context(): MarkdownContext {
  let next = 0;
  return {
    newBlockId: () => `b${next++}`,
    resolveLink: () => null,
    resolveMedia: (href) => (href.startsWith("/api/media/") ? href : null),
    onIgnored: () => {},
    onConverted: () => {},
  };
}

const text = (value: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: value, styles });
const block = (type: string, content: unknown[] = [], props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  id: "x",
  type,
  props,
  content,
  children,
});

describe("inlineMarkdown", () => {
  it("rend les styles, les liens et les mentions", () => {
    const content = [
      text("Un "),
      text("gras", { bold: true }),
      text(", "),
      text("italique", { italic: true }),
      text(", "),
      text("les deux", { bold: true, italic: true }),
      text(", "),
      text("barré", { strike: true }),
      text(" et "),
      text("code", { code: true }),
      text(" "),
      { type: "link", href: "https://ex.be/a", content: [text("lien")] },
      text(" "),
      { type: "mention", props: { url: "https://ex.be/b", title: "Article" } },
    ];
    expect(inlineMarkdown(content)).toBe(
      "Un **gras**, *italique*, ***les deux***, ~~barré~~ et `code` [lien](https://ex.be/a) [Article](https://ex.be/b)",
    );
  });

  it("sort les espaces des marques et fusionne deux textes voisins de même style", () => {
    expect(inlineMarkdown([text(" gras ", { bold: true }), text("suite")])).toBe(" **gras** suite");
    expect(inlineMarkdown([text("a", { bold: true }), text("b", { bold: true })])).toBe("**ab**");
  });

  it("rend absolus les chemins du site quand l'origine est donnée", () => {
    const content = [{ type: "link", href: "/page/pg_0123456789abcdef", content: [text("ici")] }];
    expect(inlineMarkdown(content, { origin: "https://n.be" })).toBe("[ici](https://n.be/page/pg_0123456789abcdef)");
    expect(inlineMarkdown(content)).toBe("[ici](/page/pg_0123456789abcdef)");
  });

  it("une mention sans titre prend le domaine", () => {
    expect(inlineMarkdown([{ type: "mention", props: { url: "https://www.ex.be/x", title: "" } }])).toBe(
      "[ex.be](https://www.ex.be/x)",
    );
  });
});

describe("escapeMarkdown", () => {
  it("échappe ce que parseInline sait relire, laisse snake_case et un tilde seul", () => {
    expect(escapeMarkdown("a*b [c] `d` \\ e")).toBe("a\\*b \\[c\\] \\`d\\` \\\\ e");
    expect(escapeMarkdown("snake_case ~ 2 h ~~x")).toBe("snake_case ~ 2 h \\~\\~x");
    expect(escapeMarkdown("_seul_")).toBe("_seul_");
    expect(escapeMarkdown(" _ ")).toBe(" \\_ ");
  });
});

describe("blocksToMarkdown", () => {
  it("rend titres, listes imbriquées, cases, citation, code et séparateur", () => {
    const body = [
      block("heading", [text("Titre")], { level: 2 }),
      block("bulletListItem", [text("parent")], {}, [block("bulletListItem", [text("enfant")])]),
      block("bulletListItem", [text("second")]),
      block("checkListItem", [text("fait")], { checked: true }),
      block("checkListItem", [text("à faire")], { checked: false }),
      block("quote", [text("Une citation")]),
      { id: "c", type: "codeBlock", props: { language: "js" }, content: [text("const a = 1;\nconst b = 2;")], children: [] },
      { id: "d", type: "divider", props: {}, children: [] },
    ];
    expect(blocksToMarkdown(body)).toBe(
      [
        "## Titre",
        "",
        "- parent",
        "  - enfant",
        "- second",
        "",
        "- [x] fait",
        "- [ ] à faire",
        "",
        "> Une citation",
        "",
        "```js",
        "const a = 1;",
        "const b = 2;",
        "```",
        "",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("numérote depuis start et reprend à 1 après une interruption sans start", () => {
    const body = [
      block("numberedListItem", [text("un")]),
      block("numberedListItem", [text("deux")], {}, [block("numberedListItem", [text("sous")])]),
      block("paragraph", [text("pause")]),
      block("numberedListItem", [text("trois")], { start: 3 }),
      block("numberedListItem", [text("quatre")]),
      block("paragraph", [text("pause")]),
      block("numberedListItem", [text("neuf")]),
    ];
    expect(blocksToMarkdown(body)).toBe(
      ["1. un", "2. deux", "   1. sous", "", "pause", "", "3. trois", "4. quatre", "", "pause", "", "1. neuf", ""].join("\n"),
    );
  });

  it("rend un tableau natif en tableau pipe, la première ligne en tête", () => {
    const table = {
      id: "t",
      type: "table",
      props: {},
      content: {
        type: "tableContent",
        rows: [
          { cells: [{ type: "tableCell", content: [text("Étape")] }, { type: "tableCell", content: [text("Commande")] }] },
          { cells: [[text("1")], [text("a | b", { code: true })]] },
          { cells: [[text("2")]] },
        ],
      },
      children: [],
    };
    expect(blocksToMarkdown([table])).toBe(["| Étape | Commande |", "| --- | --- |", "| 1 | `a \\| b` |", "| 2 |   |", ""].join("\n"));
  });

  it("rend images, fichiers, signets et vidéos en liens absolus", () => {
    const body = [
      { id: "i", type: "image", props: { url: "/api/media/up_0123456789abcdef.png", caption: "Schéma" }, children: [] },
      { id: "f", type: "file", props: { url: "/api/media/up_0123456789abcdeg.pdf", name: "grille.pdf", caption: "" }, children: [] },
      { id: "s", type: "bookmark", props: { url: "https://ex.be", title: "Exemple" }, children: [] },
      { id: "y", type: "youtube", props: { url: "https://youtu.be/abc" }, children: [] },
      { id: "v", type: "image", props: { url: "" }, children: [] },
    ];
    expect(blocksToMarkdown(body, { origin: "https://n.be" })).toBe(
      [
        "![Schéma](https://n.be/api/media/up_0123456789abcdef.png)",
        "",
        "[grille.pdf](https://n.be/api/media/up_0123456789abcdeg.pdf)",
        "",
        "[Exemple](https://ex.be)",
        "",
        "[Vidéo YouTube](https://youtu.be/abc)",
        "",
      ].join("\n"),
    );
  });

  it("rend sous-pages et vues liées en lien vers leur id, et tait une cible disparue", () => {
    const body = [
      { id: "a", type: "subpage", props: { pageId: "pg_vivante" }, children: [] },
      { id: "b", type: "linked", props: { databaseId: "pg_base" }, children: [] },
      { id: "c", type: "subpage", props: { pageId: "pg_partie" }, children: [] },
    ];
    const titles: Record<string, string> = { pg_vivante: "Linux", pg_base: "To Do" };
    const target = (id: string) => (titles[id] ? { title: titles[id] } : null);
    expect(blocksToMarkdown(body, { target })).toBe("[Linux](pg_vivante)\n\n[To Do](pg_base)\n");
  });

  it("aplatit les colonnes dans l'ordre et saute les paragraphes vides", () => {
    const body = [
      {
        id: "l",
        type: "columnList",
        props: {},
        children: [
          { id: "c1", type: "column", props: {}, children: [block("paragraph", [text("gauche")])] },
          { id: "c2", type: "column", props: {}, children: [block("paragraph", [text("droite")]), block("paragraph", [])] },
        ],
      },
      block("paragraph", []),
    ];
    expect(blocksToMarkdown(body)).toBe("gauche\n\ndroite\n");
  });

  it("protège un paragraphe qui commence par #", () => {
    expect(blocksToMarkdown([block("paragraph", [text("#hashtag")])])).toBe("\\#hashtag\n");
  });

  it("rend un corps vide ou invalide en chaîne vide", () => {
    expect(blocksToMarkdown([])).toBe("");
    expect(blocksToMarkdown(null)).toBe("");
  });
});

describe("aller-retour avec markdownToBlocks", () => {
  const corpus = [
    "# Installer Linux Mint",
    "",
    "Un paragraphe avec **gras**, *italique*, ***les deux***, ~~barré~~ et `code`.",
    "",
    "Un [lien](https://exemple.be/a), une \\*étoile\\* échappée et snake_case.",
    "",
    "## Préparer",
    "",
    "- premier",
    "  - imbriqué",
    "- second",
    "",
    "1. un",
    "2. deux",
    "",
    "- [x] fait",
    "- [ ] à faire",
    "",
    "> Une citation",
    "",
    "```bash",
    "sudo apt update",
    "```",
    "",
    "---",
    "",
    "![Écran d'accueil](/api/media/up_0123456789abcdef.png)",
    "",
    "### Fin",
    "",
  ].join("\n");

  it("relit le Markdown à l'identique", () => {
    expect(blocksToMarkdown(markdownToBlocks(corpus, context()).blocks)).toBe(corpus);
  });

  it("donne les mêmes blocs après un second passage", () => {
    const first = markdownToBlocks(corpus, context()).blocks;
    const second = markdownToBlocks(blocksToMarkdown(first), context()).blocks;
    expect(second).toEqual(first);
  });
});

const STATUS: Property = {
  id: "p_statut",
  name: "Statut",
  type: "select",
  options: [
    { id: "o_faire", name: "À faire", color: "gray" },
    { id: "o_fait", name: "Fait", color: "green" },
  ],
};
const TAGS: Property = {
  id: "p_tags",
  name: "Étiquettes",
  type: "multiselect",
  options: [
    { id: "o_a", name: "école", color: "blue" },
    { id: "o_b", name: "IA", color: "red" },
  ],
};
const PROPS: Property[] = [
  STATUS,
  TAGS,
  { id: "p_date", name: "Échéance", type: "date" },
  { id: "p_ok", name: "Urgent", type: "checkbox" },
  { id: "p_n", name: "Durée", type: "number" },
  { id: "p_note", name: "Note", type: "text" },
  { id: "p_rel", name: "Projet", type: "relation", target: "pg_projets" },
  { id: "p_cree", name: "Créé le", type: "created_time" },
];

function entry(id: string, title: string, values: EntryRow["values"], links?: EntryRow["links"]): EntryRow {
  return { id, title, icon: null, values, manualOrder: "a0", createdAt: "2026-11-10T08:00:00Z", updatedAt: "2026-11-10T08:00:00Z", links };
}

describe("databaseToMarkdown", () => {
  it("rend le titre en lien et les seules propriétés simples", () => {
    const md = databaseToMarkdown(PROPS, [
      entry("pg_e1", "Rédiger | relire", { p_statut: "o_faire", p_tags: ["o_a", "o_b"], p_ok: true, p_n: 1.5, p_date: "2026-11-12" }),
      entry("pg_e2", "", {}),
    ]);
    expect(md).toBe(
      [
        "| Titre | Statut | Étiquettes | Échéance | Urgent | Durée | Note |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| [Rédiger \\| relire](pg_e1) | À faire | école, IA | 2026-11-12 | oui | 1,5 |   |",
        "| [Sans titre](pg_e2) |   |   |   |   |   |   |",
        "",
      ].join("\n"),
    );
  });

  it("dit qu'une base est vide", () => {
    expect(databaseToMarkdown([STATUS], [])).toBe("| Titre | Statut |\n| --- | --- |\n\nAucune entrée.\n");
  });
});

describe("entryValues et frontMatter", () => {
  it("rend les valeurs par nom, relation par titres, sans vide ni valeur calculée", () => {
    const row = entry(
      "pg_e1",
      "Tâche",
      { p_statut: "o_fait", p_tags: ["o_b"], p_ok: true, p_n: 3, p_note: "oui", p_date: "2026-11-12" },
      {
        p_rel: [
          { id: "pg_p1", title: "Linux", icon: null, trashed: false, publicBaseId: null },
          { id: "pg_p2", title: "Vieux", icon: null, trashed: true, publicBaseId: null },
        ],
      },
    );
    expect(frontMatter(entryValues(PROPS, row))).toBe(
      [
        "---",
        "Statut: Fait",
        "Étiquettes:",
        "  - IA",
        'Échéance: "2026-11-12"',
        "Urgent: oui",
        "Durée: 3",
        'Note: "oui"',
        "Projet:",
        "  - Linux",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("rend une entrée sans valeur sans front matter", () => {
    expect(frontMatter(entryValues(PROPS, entry("pg_e", "Vide", {})))).toBe("");
  });
});

describe("yamlString", () => {
  it("laisse nu le texte sans ambiguïté et cite le reste", () => {
    expect(yamlString("À faire")).toBe("À faire");
    expect(yamlString("2026-11-12")).toBe('"2026-11-12"');
    expect(yamlString("non")).toBe('"non"');
    expect(yamlString("a: b")).toBe('"a: b"');
    expect(yamlString("- puce")).toBe('"- puce"');
    expect(yamlString("")).toBe('""');
    expect(yamlString("deux\nlignes")).toBe('"deux\\nlignes"');
  });
});

describe("aller-retour avec le profil agent", () => {
  const corpus = [
    "Voir [https://ex.be/a](https://ex.be/a) et le tableau :",
    "",
    "| Marque | Touche |",
    "| --- | --- |",
    "| HP | **F9** |",
    "| Dell \\| Alienware | F12 |",
    "",
    "1. un",
    "2. deux",
    "",
    "```",
    "code",
    "```",
    "",
    "3. trois",
    "4. quatre",
    "",
  ].join("\n");

  it("relit tableaux et numérotation reprise à l'identique", () => {
    const blocks = markdownToBlocks(corpus, { ...context(), profile: "agent" }).blocks;
    expect(blocksToMarkdown(blocks)).toBe(corpus);
  });
});
