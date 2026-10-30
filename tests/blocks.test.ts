import { describe, expect, it } from "vitest";
import { appendOrphans, columnHasContent, columnStructure, flattenToText, refChanges, renderHtml, safeHref, subpageRefs } from "@/lib/blocks";

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

const text = (value: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: value, styles });
const block = (type: string, content: unknown = [], props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  type,
  props,
  content,
  children,
});

describe("safeHref", () => {
  it("garde le web, le courriel et les chemins du site", () => {
    expect(safeHref("https://ex.be/a?b=1")).toBe("https://ex.be/a?b=1");
    expect(safeHref("mailto:a@ex.be")).toBe("mailto:a@ex.be");
    expect(safeHref("/api/media/up_x.png")).toBe("/api/media/up_x.png");
  });

  it("refuse javascript:, data: et les chemins lus comme un autre hôte", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});

describe("renderHtml", () => {
  it("échappe le texte, y compris dans les attributs", () => {
    const body = [block("paragraph", [text('<script>alert("x")</script> & co')])];
    expect(renderHtml(body)).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co</p>");
  });

  it("rend les styles en ligne et les retours à la ligne", () => {
    const body = [block("paragraph", [text("gras", { bold: true }), text(" et\nbarré", { strike: true, italic: true })])];
    expect(renderHtml(body)).toBe("<p><strong>gras</strong><em><s> et<br>barré</s></em></p>");
  });

  it("n'accepte qu'une couleur de la palette, en classe", () => {
    const body = [block("paragraph", [text("a", { textColor: "red" }), text("b", { backgroundColor: "red;x:1" })])];
    expect(renderHtml(body)).toBe('<p><span class="tc-red">a</span>b</p>');
  });

  it("ouvre un lien externe dans un nouvel onglet et retire un lien piégé", () => {
    const body = [
      block("paragraph", [
        { type: "link", href: "https://ex.be", content: [text("ici")] },
        { type: "link", href: "javascript:alert(1)", content: [text("là")] },
      ]),
    ];
    expect(renderHtml(body)).toBe('<p><a href="https://ex.be/" target="_blank" rel="noopener noreferrer">ici</a>là</p>');
  });

  it("décale les titres d'un cran, le titre de la page étant le h1", () => {
    expect(renderHtml([block("heading", [text("A")], { level: 1 })])).toBe("<h2>A</h2>");
    expect(renderHtml([block("heading", [text("B")], { level: 6 })])).toBe("<h6>B</h6>");
    expect(renderHtml([block("heading", [text("C")], { level: "<x>" })])).toBe("<h2>C</h2>");
  });

  it("regroupe les éléments de liste consécutifs et imbrique les enfants", () => {
    const body = [
      block("bulletListItem", [text("un")], {}, [block("bulletListItem", [text("un.un")])]),
      block("bulletListItem", [text("deux")]),
      block("numberedListItem", [text("premier")], { start: 3 }),
      block("numberedListItem", [text("suivant")]),
    ];
    expect(renderHtml(body)).toBe(
      "<ul><li>un<ul><li>un.un</li></ul></li><li>deux</li></ul>" + '<ol start="3"><li>premier</li><li>suivant</li></ol>',
    );
  });

  it("rend une case cochée en lecture seule", () => {
    const body = [block("checkListItem", [text("fait")], { checked: true }), block("checkListItem", [text("à faire")])];
    expect(renderHtml(body)).toBe(
      '<ul class="checklist"><li class="checked"><input type="checkbox" disabled checked aria-label="Cochée"> fait</li>' +
        '<li><input type="checkbox" disabled aria-label="Non cochée"> à faire</li></ul>',
    );
  });

  it("rend un dépliant en details et le code sans interpréter son contenu", () => {
    const body = [
      block("toggleListItem", [text("Plus")], {}, [block("paragraph", [text("caché")])]),
      block("codeBlock", [text("a < b && c", { bold: true })], { language: "js" }),
      block("divider", undefined),
    ];
    expect(renderHtml(body)).toBe(
      "<details><summary>Plus</summary><p>caché</p></details><pre><code>a &lt; b &amp;&amp; c</code></pre><hr>",
    );
  });

  it("rend une image déposée avec sa légende, et ignore une source piégée", () => {
    const body = [
      block("image", undefined, { url: "/api/media/up_AbCdEfGhIjKlMnOp.png", caption: "Schéma", name: "s.png", previewWidth: 320 }),
      block("image", undefined, { url: "javascript:alert(1)", caption: "x" }),
    ];
    expect(renderHtml(body)).toBe(
      '<figure class="media-image"><img src="/api/media/up_AbCdEfGhIjKlMnOp.png" alt="Schéma" loading="lazy" style="width:320px">' +
        "<figcaption>Schéma</figcaption></figure>",
    );
  });

  it("rend un fichier en lien et une vidéo YouTube par son seul identifiant", () => {
    const body = [
      block("file", undefined, { url: "/api/media/up_0123456789abcdef.pdf", name: "grille.pdf" }),
      block("youtube", undefined, { url: "https://youtu.be/dQw4w9WgXcQ?t=3" }),
      block("youtube", undefined, { url: "https://evil.example/embed" }),
    ];
    expect(renderHtml(body)).toBe(
      '<p class="media-file"><a href="/api/media/up_0123456789abcdef.pdf" target="_blank" rel="noopener noreferrer">grille.pdf</a></p>' +
        '<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Vidéo YouTube" loading="lazy"' +
        ' allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen' +
        ' referrerpolicy="strict-origin-when-cross-origin"></iframe></div>',
    );
  });

  it("garde l'alignement et la couleur du bloc, en classes", () => {
    const body = [block("paragraph", [text("centré")], { textAlignment: "center", backgroundColor: "yellow" })];
    expect(renderHtml(body)).toBe('<p class="align-center bg-yellow">centré</p>');
  });

  it("indente les enfants d'un paragraphe et ignore un corps illisible", () => {
    const body = [block("paragraph", [text("a")], {}, [block("paragraph", [text("b")])]), null, "x", { type: "inconnu" }];
    expect(renderHtml(body)).toBe('<p>a</p><div class="block-children"><p>b</p></div>');
    expect(renderHtml("pas une liste")).toBe("");
  });
});

const sub = (pageId: string, children: unknown[] = []) => block("subpage", undefined, { pageId, kind: "page" }, children);

describe("subpageRefs", () => {
  it("compte les blocs-liens par sous-page, enfants compris, et ignore un bloc en attente", () => {
    const body = [sub("pg_a"), block("paragraph", [text("x")], {}, [sub("pg_a"), sub("pg_b")]), sub("")];
    expect(subpageRefs(body)).toEqual(new Map([["pg_a", 2], ["pg_b", 1]]));
    expect(subpageRefs("illisible")).toEqual(new Map());
  });
});

describe("refChanges", () => {
  const map = (entries: [string, number][]) => new Map(entries);

  it("signale une sous-page dont le dernier bloc disparaît, pas une dont un doublon reste", () => {
    expect(refChanges(map([["pg_a", 1], ["pg_b", 2]]), map([["pg_b", 1]]))).toEqual({ gone: ["pg_a"], back: [] });
  });

  it("signale une sous-page qui revient (annulation, collage)", () => {
    expect(refChanges(map([]), map([["pg_a", 1]]))).toEqual({ gone: [], back: ["pg_a"] });
  });

  it("ne signale rien quand le bloc a seulement bougé", () => {
    expect(refChanges(map([["pg_a", 1]]), map([["pg_a", 1]]))).toEqual({ gone: [], back: [] });
  });
});

describe("renderHtml, sous-pages", () => {
  it("rend un bloc-lien par le résolveur, et le retire si la sous-page n'est pas lisible", () => {
    const body = [sub("pg_a"), sub("pg_x")];
    const html = renderHtml(body, {
      subpage: (id) => (id === "pg_a" ? { href: "/p/pub/pg_a", title: '<Notes> & "idées"', icon: null, type: "page" } : null),
    });
    expect(html).toBe(
      '<p class="subpage-link"><a href="/p/pub/pg_a"><span class="page-icon" aria-hidden="true">📄</span> &lt;Notes&gt; &amp; &quot;idées&quot;</a></p>',
    );
  });

  it("rend l'icône image d'une sous-page, jamais une image au nom invalide", () => {
    const link = (icon: string) => ({ href: "/p/pub/pg_a", title: "Logo", icon, type: "page" });
    const image = renderHtml([sub("pg_a")], { subpage: () => link("image:up_AbCdEfGhIjKlMnOp.png") });
    expect(image).toContain('<img class="page-icon page-icon-img" src="/api/media/up_AbCdEfGhIjKlMnOp.png" alt=""');
    const forged = renderHtml([sub("pg_a")], { subpage: () => link('image:"><script>') });
    expect(forged).not.toContain("<script>");
    expect(forged).toContain(">📄</span>");
  });

  it("ne rend rien sans résolveur", () => {
    expect(renderHtml([sub("pg_a")])).toBe("");
  });
});

const column = (children: unknown[]) => block("column", [], {}, children);

describe("colonnes", () => {
  it("pose une liste de deux à quatre colonnes, chacune habitée d'un paragraphe", () => {
    const two = columnStructure(2);
    expect(two.type).toBe("columnList");
    expect(two.children).toHaveLength(2);
    expect(two.children[0]).toEqual({ type: "column", children: [{ type: "paragraph" }] });
  });

  it("ramène toute demande hors bornes entre deux et quatre colonnes", () => {
    expect(columnStructure(1).children).toHaveLength(2);
    expect(columnStructure(9).children).toHaveLength(4);
    expect(columnStructure(3.7).children).toHaveLength(3);
  });

  it("ne compte pas une colonne vide, compte texte, média, bloc-lien et séparateur", () => {
    expect(columnHasContent(column([block("paragraph", [text("  ")])]))).toBe(false);
    expect(columnHasContent(column([block("paragraph", [text("Une phrase")])]))).toBe(true);
    expect(columnHasContent(column([block("image", [], { url: "" })]))).toBe(false);
    expect(columnHasContent(column([block("image", [], { url: "/api/media/up_x.png" })]))).toBe(true);
    expect(columnHasContent(column([block("divider")]))).toBe(true);
    expect(columnHasContent(column([block("paragraph", [], {}, [sub("pg_a")])]))).toBe(true);
  });

  it("rend les colonnes côte à côte dans la vue publique", () => {
    const body = [
      block("columnList", [], {}, [
        column([block("paragraph", [text("gauche")])]),
        column([block("paragraph", [text("droite")])]),
      ]),
    ];
    expect(renderHtml(body)).toBe(
      '<div class="body-columns"><div class="body-column"><p>gauche</p></div><div class="body-column"><p>droite</p></div></div>',
    );
  });

  it("garde le texte des colonnes dans la recherche", () => {
    const body = [
      block("columnList", [], {}, [
        column([block("paragraph", [text("gauche")])]),
        column([block("paragraph", [text("droite")])]),
      ]),
    ];
    expect(flattenToText(body)).toBe("gauche\ndroite");
  });
});
