import { describe, expect, it } from "vitest";
import { htmlToPage, type HtmlContext } from "@/lib/notion-html";

function counter() {
  let next = 0;
  return () => `b${next++}`;
}

function context(overrides: Partial<HtmlContext> = {}): HtmlContext {
  return {
    newBlockId: counter(),
    pageId: "pg_test",
    resolveLink: () => null,
    resolveMedia: () => null,
    resolveCollection: () => null,
    onIgnored: () => undefined,
    onConverted: () => undefined,
    ...overrides,
  };
}

const PAGE = `<!doctype html><html><head><title>Titre du document</title></head>
<body><article id="aaaa">
<header>
  <img class="page-cover-image" src="Page/cover.jpg" style="object-position:center 3.04%"/>
  <div class="page-header-icon page-header-icon-with-cover"><span class="icon" data-emoji="🔑"></span></div>
  <h1 class="page-title" dir="auto">Page test</h1>
</header>
<div class="page-body">
  <h2>Titre de section</h2>
  <p>Un <strong>mot</strong>, <em>une emphase</em>, du <code>code</code> et un <a href="https://exemple.fr">lien</a>.</p>
  <ul class="bulleted-list"><li>Un</li><li>Deux</li></ul>
  <details open=""><summary><h1 style="display:inline-block">Plié</h1></summary><div class="indented"><p>Dedans.</p></div></details>
  <div class="column-list"><div class="column"><p>Gauche</p></div><div class="column"><p>Droite</p></div></div>
  <table class="simple-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
  <figure class="image"><a href="Page/img.png"><img src="Page/img.png" style="width:615.99px"/></a><figcaption>Légende</figcaption></figure>
  <figure><a href="https://github.com/Anto-py/pret_pc_public" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">GitHub</div><div class="bookmark-description">Un dépôt public</div></div><div class="bookmark-href"><img src="https://github.com/favicon.ico" class="icon bookmark-icon"/>github.com</div></div><img src="https://opengraph.example/carte.png" class="bookmark-image"/></a></figure>
  <figure><div class="source"><a href="Page/doc.pdf">attachment:6bd0:doc.pdf</a></div></figure>
  <figure class="link-to-page"><a href="Page/Enfant%20bbb.html" data-notion-page-id="bbb">Enfant</a></figure>
</div>
</article></body></html>`;

describe("htmlToPage", () => {
  it("lit le titre, l'icône, le bandeau et son cadrage", () => {
    const page = htmlToPage(PAGE, context());
    expect(page.title).toBe("Page test");
    expect(page.icon).toEqual({ kind: "emoji", emoji: "🔑" });
    expect(page.coverPath).toBe("Page/cover.jpg");
    expect(page.coverPosition).toBe(3);
  });

  it("produit les blocs du schéma, dépliants, colonnes et tableaux compris", () => {
    const page = htmlToPage(
      PAGE,
      context({
        resolveMedia: (src) =>
          src.endsWith(".pdf") ? "/api/media/up_doc.pdf" : src.endsWith(".png") ? "/api/media/up_img.png" : null,
        resolveLink: (href) =>
          href.includes("Enfant") ? { href: "/page/pg_enfant", pageId: "pg_enfant", kind: "page" } : null,
      }),
    );
    expect(page.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "bulletListItem",
      "toggleListItem",
      "columnList",
      "table",
      "image",
      "bookmark",
      "file",
      "subpage",
    ]);
    const paragraph = page.blocks[1];
    expect(paragraph.content).toEqual([
      { type: "text", text: "Un ", styles: {} },
      { type: "text", text: "mot", styles: { bold: true } },
      { type: "text", text: ", ", styles: {} },
      { type: "text", text: "une emphase", styles: { italic: true } },
      { type: "text", text: ", du ", styles: {} },
      { type: "text", text: "code", styles: { code: true } },
      { type: "text", text: " et un ", styles: {} },
      { type: "link", href: "https://exemple.fr", content: [{ type: "text", text: "lien", styles: {} }] },
      { type: "text", text: ".", styles: {} },
    ]);
    const toggle = page.blocks[4];
    expect(toggle.content).toEqual([{ type: "text", text: "Plié", styles: {} }]);
    expect(toggle.children.map((block) => block.type)).toEqual(["paragraph"]);
    const columns = page.blocks[5];
    expect(columns.children).toHaveLength(2);
    expect(columns.children[0].type).toBe("column");
    const table = page.blocks[6];
    const content = table.content as { headerRows?: number; rows: { cells: unknown[] }[] };
    expect(content.headerRows).toBe(1);
    expect(content.rows).toHaveLength(2);
    expect(content.rows[0].cells).toHaveLength(2);
    const image = page.blocks[7];
    expect(image.props.url).toBe("/api/media/up_img.png");
    expect(image.props.caption).toBe("Légende");
    expect(image.props.previewWidth).toBe(616);
    const bookmark = page.blocks[8];
    expect(bookmark.props).toMatchObject({
      url: "https://github.com/Anto-py/pret_pc_public",
      title: "GitHub",
      description: "Un dépôt public",
      favicon: "",
      image: "",
      pageId: "pg_test",
    });
    expect(page.remoteImages).toEqual([
      { blockId: bookmark.id, url: "https://github.com/favicon.ico", prop: "favicon" },
      { blockId: bookmark.id, url: "https://opengraph.example/carte.png", prop: "image" },
    ]);    expect(page.blocks[9].props).toMatchObject({ url: "/api/media/up_doc.pdf", name: "doc.pdf" });
    expect(page.blocks[10].props).toEqual({ pageId: "pg_enfant", kind: "page" });
    expect(page.subpageIds).toEqual(["bbb"]);
  });

  it("relie un tableau de collection à sa base quand elle est connue", () => {
    const html = `<article><div class="page-body"><h4 class="collection-title">Tâches</h4>
      <table class="collection-content"><tbody><tr><td>Une</td></tr></tbody></table></div></article>`;
    const page = htmlToPage(html, context({ resolveCollection: (title) => (title === "Tâches" ? "pg_db" : null) }));
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]).toMatchObject({ type: "linked", props: { databaseId: "pg_db", config: "" } });
  });

  it("compte les conversions et les pertes", () => {
    const ignored: string[] = [];
    const converted: string[] = [];
    htmlToPage(PAGE, context({ onIgnored: (reason) => ignored.push(reason), onConverted: (reason) => converted.push(reason) }));
    expect(ignored).toContain("image absente de l'archive");
  });

  it("ne combine jamais le style code avec un autre", () => {
    const html = `<article><div class="page-body"><p><strong><code>gras code</code></strong> et <em>code</em>.</p></div></article>`;
    const page = htmlToPage(html, context());
    const content = page.blocks[0].content as { text: string; styles: Record<string, boolean> }[];
    expect(content[0].styles).toEqual({ code: true });
    expect(content[0].text).toBe("gras code");
  });

  it("lit une icône image et un dépliant sans titre", () => {
    const html = `<article><header><div class="page-header-icon undefined"><img class="icon" src="Page/icon.png"/></div></header>
      <div class="page-body"><details><summary>Sans titre de heading</summary><p>Corps.</p></details></div></article>`;
    const page = htmlToPage(html, context());
    expect(page.icon).toEqual({ kind: "image", path: "Page/icon.png" });
    expect(page.blocks[0].type).toBe("toggleListItem");
    expect(page.blocks[0].children).toHaveLength(1);
  });
});
