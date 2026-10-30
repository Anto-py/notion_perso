import { describe, expect, it } from "vitest";
import { markdownToBlocks, parseInline, type Block, type MarkdownContext } from "@/lib/notion-markdown";

function context(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  let next = 0;
  return {
    newBlockId: () => `b${next++}`,
    resolveLink: () => null,
    resolveMedia: () => null,
    onIgnored: () => {},
    onConverted: () => {},
    ...overrides,
  };
}

function parse(markdown: string, overrides: Partial<MarkdownContext> = {}): Block[] {
  return markdownToBlocks(markdown, context(overrides)).blocks;
}

function textOf(block: Block): string {
  return Array.isArray(block.content)
    ? (block.content as { text?: string }[]).map((item) => item.text ?? "").join("")
    : "";
}

describe("markdownToBlocks", () => {
  it("rend titres et paragraphes", () => {
    const blocks = parse("# Titre\n\nUn paragraphe\nsur deux lignes.");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
    expect(blocks[0].props.level).toBe(1);
    expect(textOf(blocks[1])).toBe("Un paragraphe sur deux lignes.");
  });

  it("imbrique les listes par indentation", () => {
    const blocks = parse("- un\n  - deux\n- trois");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children).toHaveLength(1);
    expect(textOf(blocks[0].children[0])).toBe("deux");
    expect(textOf(blocks[1])).toBe("trois");
  });

  it("distingue les cases à cocher", () => {
    const blocks = parse("- [x] fait\n- [ ] à faire");
    expect(blocks.map((block) => block.props.checked)).toEqual([true, false]);
  });

  it("rend le code sans interpréter son contenu", () => {
    const blocks = parse("```ts\nconst a = **1**;\n```");
    expect(blocks[0].type).toBe("codeBlock");
    expect(blocks[0].props.language).toBe("ts");
    expect(textOf(blocks[0])).toBe("const a = **1**;");
  });

  it("convertit un callout <aside> en citation", () => {
    const blocks = parse("<aside>\n💡 Pense à relire\n</aside>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("quote");
    expect(textOf(blocks[0])).toBe("💡 Pense à relire");
  });

  it("convertit un tableau en liste et le signale", () => {
    const converted: string[] = [];
    const blocks = parse("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |", { onConverted: (reason) => converted.push(reason) });
    expect(blocks.map(textOf)).toEqual(["1 · 2", "3 · 4"]);
    expect(converted).toEqual(["tableau converti en liste"]);
  });

  it("rend un lien de sous-page seul en bloc subpage", () => {
    const blocks = parse("[Enfant](Parent%20abc/Enfant%20def.md)", {
      resolveLink: () => ({ href: "/page/pg_enfant", pageId: "pg_enfant", kind: "page" }),
    });
    expect(blocks[0].type).toBe("subpage");
    expect(blocks[0].props).toEqual({ pageId: "pg_enfant", kind: "page" });
  });

  it("garde un lien externe en paragraphe", () => {
    const blocks = parse("[Notion](https://www.notion.so/x)");
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].content).toEqual([
      { type: "link", href: "https://www.notion.so/x", content: [{ type: "text", text: "Notion", styles: {} }] },
    ]);
  });

  it("rend une image résolue en bloc image", () => {
    const blocks = parse("![Schéma](Parent%20abc/image.png)", {
      resolveMedia: () => "/api/media/up_0123456789ABCDEF.png",
    });
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].props.url).toBe("/api/media/up_0123456789ABCDEF.png");
    expect(blocks[0].props.caption).toBe("Schéma");
  });

  it("signale une image absente", () => {
    const ignored: string[] = [];
    const blocks = parse("![Schéma](image.png)", { onIgnored: (reason) => ignored.push(reason) });
    expect(blocks[0].type).toBe("paragraph");
    expect(ignored).toEqual(["image absente de l'archive"]);
  });

  it("compose les emphases", () => {
    const items = parseInline("Un **gras avec *italique*** et du `code`.", context());
    expect(items).toEqual([
      { type: "text", text: "Un ", styles: {} },
      { type: "text", text: "gras avec ", styles: { bold: true } },
      { type: "text", text: "italique", styles: { bold: true, italic: true } },
      { type: "text", text: " et du ", styles: {} },
      { type: "text", text: "code", styles: { code: true } },
      { type: "text", text: ".", styles: {} },
    ]);
  });

  it("rend un lien mort en texte", () => {
    const ignored: string[] = [];
    const items = parseInline("[Fantôme](absent.md)", context({ onIgnored: (reason) => ignored.push(reason) }));
    expect(items).toEqual([{ type: "text", text: "Fantôme", styles: {} }]);
    expect(ignored).toEqual(["lien sans cible dans l'archive"]);
  });

  it("lit un fichier dont le nom porte des parenthèses", () => {
    const blocks = parse("[Doc](Dossier/WOOFLASH_presentation_(1).pdf)", {
      resolveMedia: () => "/api/media/up_0123456789ABCDEF.pdf",
    });
    expect(blocks[0].type).toBe("file");
    expect(blocks[0].props.name).toBe("Doc");
  });

  it("lit une image dont le nom porte des parenthèses", () => {
    const items = parseInline("![Capture (1)](Dossier/image_(1).png)", context({ resolveMedia: () => "/api/media/up_0123456789ABCDEF.png" }));
    expect(items[0]).toMatchObject({ type: "link", href: "/api/media/up_0123456789ABCDEF.png" });
  });

  it("lit une sous-page dont le nom porte des parenthèses", () => {
    const blocks = parse("[Sara (FHG)](Accompagnements/Sara%20Lebboukh%20(FHG).md)", {
      resolveLink: () => ({ href: "/page/pg_sara", pageId: "pg_sara", kind: "page" }),
    });
    expect(blocks[0].type).toBe("subpage");
    expect(blocks[0].props.pageId).toBe("pg_sara");
  });

  it("rend séparateurs et citations", () => {
    const blocks = parse("> Une citation\n\n---");
    expect(blocks.map((block) => block.type)).toEqual(["quote", "divider"]);
  });
});
