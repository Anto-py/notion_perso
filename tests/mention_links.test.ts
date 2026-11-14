import { describe, expect, it } from "vitest";
import { bareLinkUrls, bareUrlsInText, countBareLinks, isBareLink, mentionizeBlocks, singleUrl } from "@/lib/mention_links";

describe("isBareLink", () => {
  it("reconnaît le texte qui est l'adresse elle-même", () => {
    expect(isBareLink("https://exemple.org/bitter-lesson", "https://exemple.org/bitter-lesson")).toBe(true);
    expect(isBareLink("https://exemple.org/", "https://exemple.org")).toBe(true);
    expect(isBareLink("exemple.org/page", "https://exemple.org/page")).toBe(true);
    expect(isBareLink("https://exemple.org/a?b=1#haut", "https://exemple.org/a?b=1#haut")).toBe(true);
  });

  it("compare l'hôte sans la casse", () => {
    expect(isBareLink("Exemple.ORG/page", "https://exemple.org/page")).toBe(true);
  });

  it("refuse un texte qui n'est pas l'adresse", () => {
    expect(isBareLink("cet article", "https://exemple.org/article")).toBe(false);
    expect(isBareLink("exemple.org/autre", "https://exemple.org/page")).toBe(false);
    expect(isBareLink("www.exemple.org", "https://exemple.org")).toBe(false);
    expect(isBareLink("", "https://exemple.org")).toBe(false);
  });

  it("refuse ce qui n'est pas une adresse web", () => {
    expect(isBareLink("contact@exemple.org", "mailto:contact@exemple.org")).toBe(false);
    expect(isBareLink("/page/pg_1", "/page/pg_1")).toBe(false);
    expect(isBareLink("exemple.org", "pas une url")).toBe(false);
  });
});

describe("bareUrlsInText", () => {
  it("repère les adresses et leur position", () => {
    const text = "Voir https://exemple.org/a et www.exemple.org/b.";
    expect(bareUrlsInText(text)).toEqual([
      { from: 5, to: 26, url: "https://exemple.org/a" },
      { from: 30, to: 47, url: "http://www.exemple.org/b" },
    ]);
  });

  it("garde les parenthèses appariées d'une adresse Wikipédia", () => {
    const text = "https://fr.wikipedia.org/wiki/Notion_(logiciel)";
    expect(bareUrlsInText(text)).toEqual([{ from: 0, to: text.length, url: text }]);
  });

  it("retire la ponctuation finale et une parenthèse non appariée", () => {
    expect(bareUrlsInText("(https://exemple.org/a).")).toEqual([{ from: 1, to: 22, url: "https://exemple.org/a" }]);
  });

  it("ne rend rien sans adresse", () => {
    expect(bareUrlsInText("rien à voir")).toEqual([]);
  });
});

const link = (href: string, text: string, styles: Record<string, unknown> = {}) => ({
  type: "link",
  href,
  content: [{ type: "text", text, styles }],
});
const paragraph = (content: unknown[], children: unknown[] = []) => ({
  id: "b1",
  type: "paragraph",
  props: {},
  content,
  children,
});
const table = (cells: unknown[][]) => ({
  id: "t1",
  type: "table",
  props: {},
  content: { type: "tableContent", columnWidths: [], headerRows: 0, rows: cells.map((row) => ({ cells: row })) },
  children: [],
});

describe("bareLinkUrls", () => {
  it("ramasse les adresses nues à toute profondeur, chacune une fois", () => {
    const blocks = [
      paragraph([link("https://a.org/x", "https://a.org/x"), link("https://titre.org", "un titre")]),
      {
        ...paragraph([], [paragraph([link("https://a.org/x", "https://a.org/x"), link("https://b.org/y", "https://b.org/y")])]),
        type: "bulletListItem",
      },
      table([[[link("https://c.org/z", "https://c.org/z")]], [[link("https://titre.org", "un titre")]]]),
    ];
    expect(bareLinkUrls(blocks).sort()).toEqual(["https://a.org/x", "https://b.org/y", "https://c.org/z"]);
  });

  it("laisse de côté le code, en ligne comme en bloc", () => {
    const blocks = [
      paragraph([link("https://code.org", "https://code.org", { code: true })]),
      { ...paragraph([link("https://bloc.org", "https://bloc.org")]), type: "codeBlock" },
    ];
    expect(bareLinkUrls(blocks)).toEqual([]);
  });
});

describe("countBareLinks", () => {
  it("compte les occurrences, pas les adresses distinctes", () => {
    const blocks = [
      paragraph([
        link("https://a.org/x", "https://a.org/x"),
        link("https://a.org/x", "https://a.org/x"),
        link("https://titre.org", "un titre"),
      ]),
      table([[[link("https://c.org/z", "https://c.org/z")]]]),
    ];
    expect(countBareLinks(blocks)).toBe(3);
  });

  it("ignore le code, en ligne comme en bloc", () => {
    const blocks = [
      paragraph([link("https://code.org", "https://code.org", { code: true })]),
      { ...paragraph([link("https://bloc.org", "https://bloc.org")]), type: "codeBlock" },
    ];
    expect(countBareLinks(blocks)).toBe(0);
  });
});

describe("mentionizeBlocks", () => {
  const titles = new Map([["https://a.org/x", "A"]]);

  it("change chaque lien nu en mention et laisse le reste intact", () => {
    const blocks = [
      paragraph([{ type: "text", text: "Voir ", styles: {} }, link("https://a.org/x", "https://a.org/x"), link("https://titre.org", "un titre")]),
    ];
    expect(mentionizeBlocks(blocks, titles)).toMatchObject([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Voir " },
          { type: "mention", props: { url: "https://a.org/x", title: "A" } },
          { type: "link", href: "https://titre.org" },
        ],
      },
    ]);
  });

  it("descend dans les enfants et les cellules de tableau", () => {
    const blocks = [
      { ...paragraph([], [paragraph([link("https://a.org/x", "https://a.org/x")])]), type: "bulletListItem" },
      table([[[link("https://a.org/x", "https://a.org/x")]]]),
    ];
    type OutBlock = { children: { content: unknown[] }[]; content: { rows: { cells: unknown[][] }[] } };
    const out = mentionizeBlocks(blocks, titles) as unknown as OutBlock[];
    expect(out[0].children[0].content[0]).toMatchObject({ type: "mention", props: { url: "https://a.org/x", title: "A" } });
    expect(out[1].content.rows[0].cells[0][0]).toMatchObject({ type: "mention", props: { url: "https://a.org/x", title: "A" } });
  });

  it("ne touche ni un bloc de code, ni du code en ligne", () => {
    const blocks = [
      { ...paragraph([link("https://bloc.org", "https://bloc.org")]), type: "codeBlock" },
      paragraph([link("https://code.org", "https://code.org", { code: true })]),
    ];
    expect(mentionizeBlocks(blocks, titles)).toEqual(blocks);
  });

  it("laisse la mention au domaine sans titre connu", () => {
    const blocks = [paragraph([link("https://inconnu.org", "https://inconnu.org")])];
    expect(mentionizeBlocks(blocks, new Map())).toMatchObject([
      { content: [{ type: "mention", props: { url: "https://inconnu.org", title: "" } }] },
    ]);
  });
});

describe("singleUrl", () => {
  it("rend l'adresse d'un texte qui n'est qu'elle", () => {
    expect(singleUrl("  https://exemple.org/a  ")).toBe("https://exemple.org/a");
    expect(singleUrl("www.exemple.org")).toBe("http://www.exemple.org");
    // Sans schéma ni « www. », rien ne dit qu'on a affaire à une adresse.
    expect(singleUrl("exemple.org")).toBeNull();
  });

  it("refuse un texte qui mêle autre chose", () => {
    expect(singleUrl("Voir https://exemple.org/a")).toBeNull();
    expect(singleUrl("https://a.org et https://b.org")).toBeNull();
    expect(singleUrl("pas d'adresse")).toBeNull();
  });
});
