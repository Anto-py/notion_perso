import { describe, expect, it } from "vitest";
import {
  appendAtEnd,
  appendOrphans,
  bodyHasContent,
  columnHasContent,
  columnStructure,
  flattenToText,
  internalLinkId,
  isForeignLink,
  linkedRefs,
  ownerRefs,
  subpageOwnerBlock,
  withoutOwnerBlocks,
  refChanges,
  renderHtml,
  safeHref,
  subpageRefs,
} from "@/lib/blocks";

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

describe("internalLinkId et liens internes en ligne", () => {
  const sentence = (href: string) => [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Voir la ", styles: {} },
        { type: "link", href, content: [{ type: "text", text: "taxonomie", styles: {} }] },
      ],
      children: [],
    },
  ];

  it("lit l'id d'une page ou d'une base du site, rien d'autre", () => {
    expect(internalLinkId("/page/pg_a")).toBe("pg_a");
    expect(internalLinkId("/db/pg_b/")).toBe("pg_b");
    expect(internalLinkId("/page/pg_c#titre")).toBe("pg_c");
    expect(internalLinkId("/api/media/up_x.png")).toBeNull();
    expect(internalLinkId("/page/pg_a/autre")).toBeNull();
    expect(internalLinkId("https://ex.be/page/pg_a")).toBeNull();
  });

  it("réécrit l'adresse d'un lien dans la portée, ne garde que le texte sinon", () => {
    const internal = (id: string) => (id === "pg_a" ? "/p/pub/pg_a" : null);
    expect(renderHtml(sentence("/page/pg_a"), { internal })).toBe('<p>Voir la <a href="/p/pub/pg_a">taxonomie</a></p>');
    expect(renderHtml(sentence("/page/pg_x"), { internal })).toBe("<p>Voir la taxonomie</p>");
    expect(renderHtml(sentence("https://ex.be"), { internal })).toContain('href="https://ex.be/"');
  });

  it("laisse l'adresse telle qu'écrite sans résolveur", () => {
    expect(renderHtml(sentence("/page/pg_a"))).toBe('<p>Voir la <a href="/page/pg_a">taxonomie</a></p>');
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

  it("tait l'encadré de conflit et la version qu'il garde", () => {
    const box = { id: "x", type: "conflict", props: { origin: "mac", date: "", replaces: "a" }, children: [block("paragraph", [text("perdue")])] };
    expect(renderHtml([block("paragraph", [text("gardée")]), box])).toBe("<p>gardée</p>");
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

const link = (pageId: string) => block("subpage", undefined, { pageId, kind: "page", link: true });

describe("ownerRefs", () => {
  it("ne compte que les blocs nés avec leur cible, jamais un lien, même vers un vrai enfant", () => {
    const body = [sub("pg_a"), link("pg_a"), block("paragraph", [text("x")], {}, [link("pg_b"), sub("pg_c")]), link("")];
    expect(ownerRefs(body)).toEqual(new Map([["pg_a", 1], ["pg_c", 1]]));
    expect(subpageRefs(body)).toEqual(new Map([["pg_a", 2], ["pg_b", 1], ["pg_c", 1]]));
  });

  it("efface le lien sans perdre la cible : seul le dernier bloc propriétaire la jette", () => {
    const before = ownerRefs([sub("pg_a"), link("pg_b")]);
    expect(refChanges(before, ownerRefs([sub("pg_a")]))).toEqual({ gone: [], back: [] });
    expect(refChanges(before, ownerRefs([link("pg_a"), link("pg_b")]))).toEqual({ gone: ["pg_a"], back: [] });
  });
});

describe("isForeignLink", () => {
  it("marque un lien, ou un bloc dont la cible habite ailleurs, pas une vraie sous-page", () => {
    expect(isForeignLink(true, "hote", "hote")).toBe(true);
    expect(isForeignLink(false, "ailleurs", "hote")).toBe(true);
    expect(isForeignLink(false, null, "hote")).toBe(true);
    expect(isForeignLink(false, "hote", "hote")).toBe(false);
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

  it("dit « Contenu privé » sans titre ni lien pour une cible fermée", () => {
    expect(renderHtml([sub("pg_a")], { subpage: () => "private" })).toBe('<p class="subpage-link subpage-private">Contenu privé</p>');
  });

  it("rend un lien posé par « Lien vers une page » comme un bloc de sous-page", () => {
    const resolve = (id: string) => (id === "pg_a" ? { href: "/p/pub/pg_a", title: "Veille", icon: null, type: "database" } : null);
    expect(renderHtml([link("pg_a")], { subpage: resolve })).toBe(renderHtml([sub("pg_a")], { subpage: resolve }));
    expect(renderHtml([link("pg_x"), link("")], { subpage: resolve })).toBe("");
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

  it("dit qu'un corps pèse si l'un de ses blocs pèse", () => {
    expect(bodyHasContent([])).toBe(false);
    expect(bodyHasContent(null)).toBe(false);
    expect(bodyHasContent([block("paragraph", [text(" ")]), block("paragraph")])).toBe(false);
    expect(bodyHasContent([block("paragraph"), block("paragraph", [text("Une phrase")])])).toBe(true);
    expect(bodyHasContent([block("image", [], { url: "/api/media/up_x.png" })])).toBe(true);
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

describe("vues liées", () => {
  const linked = (databaseId: string, config = "") => block("linked", [], { databaseId, config });

  it("ramasse les vues liées, colonnes comprises, et ignore celles sans base", () => {
    const body = [
      linked("db_veille", '{"views":[]}'),
      block("columnList", [], {}, [
        column([linked("")]),
        column([block("paragraph", [], {}, [linked("db_todo")])]),
      ]),
    ];
    expect(linkedRefs(body)).toEqual([
      { databaseId: "db_veille", config: '{"views":[]}' },
      { databaseId: "db_todo", config: "" },
    ]);
  });

  it("compte comme du contenu une vue liée pourvue d'une base", () => {
    expect(columnHasContent(column([linked("")]))).toBe(false);
    expect(columnHasContent(column([linked("db_veille")]))).toBe(true);
  });

  it("pose le HTML de la vue liée fourni par l'appelant, rien sans lui", () => {
    const body = [linked("db_veille", "cfg")];
    expect(renderHtml(body, { linked: (id, config) => `<div>${id}:${String(config)}</div>` })).toBe('<div>db_veille:cfg</div>');
    expect(renderHtml(body)).toBe("");
  });
});

describe("bloc signet", () => {
  const bookmark = {
    type: "bookmark",
    props: {
      url: "https://exemple.org/article",
      title: "Un article",
      description: "Description simple",
      favicon: "/api/media/up_0123456789abcdef.png",
      image: "/api/media/up_fedcba9876543210.png",
      pageId: "pg_page",
    },
  };

  it("entre dans le texte de recherche", () => {
    expect(flattenToText([bookmark])).toBe("Un article\nDescription simple\nhttps://exemple.org/article");
  });

  it("rend une carte publique, images comprises", () => {
    const html = renderHtml([bookmark]);
    expect(html).toContain('class="bookmark-card"');
    expect(html).toMatch(/href="https:\/\/exemple\.org\/article\/?"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Un article");
    expect(html).toContain("Description simple");
    expect(html).toContain('src="/api/media/up_0123456789abcdef.png"');
    expect(html).toContain('src="/api/media/up_fedcba9876543210.png"');
  });

  it("ne rend rien sans adresse web", () => {
    expect(renderHtml([{ type: "bookmark", props: { url: "javascript:alert(1)" } }])).toBe("");
  });
});

describe("mention", () => {
  const body = [
    {
      type: "paragraph",
      content: [{ type: "mention", props: { url: "https://exemple.org/a", title: "Exemple" } }],
      children: [],
    },
  ];

  it("entre dans le texte de recherche avec son titre et son adresse", () => {
    expect(flattenToText(body)).toBe("Exemple https://exemple.org/a");
  });

  it("se rend en lien avec son favicon et son titre", () => {
    const html = renderHtml(body);
    expect(html).toContain('<a class="mention" href="https://exemple.org/a" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('src="https://exemple.org/favicon.ico"');
    expect(html).toContain('<span class="mention-title">Exemple</span>');
  });

  it("refuse une adresse dangereuse et garde le titre", () => {
    const html = renderHtml([
      {
        type: "paragraph",
        content: [{ type: "mention", props: { url: "javascript:alert(1)", title: "Piège" } }],
        children: [],
      },
    ]);
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="mention">Piège</span>');
  });
});

describe("appendAtEnd", () => {
  const para = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text, styles: {} }] : [], children: [] });

  it("ajoute en bas, avant les paragraphes vides qui terminent le corps", () => {
    expect(appendAtEnd([para("a"), para(""), para("")], [para("b")])).toEqual([para("a"), para("b"), para(""), para("")]);
  });

  it("ajoute à la fin d'un corps sans vide final, et dans un corps absent", () => {
    expect(appendAtEnd([para("a")], [para("b")])).toEqual([para("a"), para("b")]);
    expect(appendAtEnd(null, [para("b")])).toEqual([para("b")]);
    expect(appendAtEnd([para("")], [para("b")])).toEqual([para("b"), para("")]);
  });
});

describe("bloc propriétaire d'une sous-page déplacée", () => {
  const owner = (id: string, pageId: string) => ({ id, type: "subpage", props: { pageId, kind: "page", link: false }, children: [] });
  const link = (id: string, pageId: string) => ({ id, type: "subpage", props: { pageId, kind: "page", link: true }, children: [] });
  const para = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });

  it("fabrique un bloc que ownerRefs compte", () => {
    expect(ownerRefs([subpageOwnerBlock("pg_a", "b1")]).get("pg_a")).toBe(1);
  });

  it("retire le bloc propriétaire, garde les liens et les autres blocs", () => {
    const { body, removed } = withoutOwnerBlocks([para("p1", "avant"), owner("b1", "pg_a"), link("b2", "pg_a"), owner("b3", "pg_b")], "pg_a");
    expect(removed).toBe(1);
    expect(body.map((block) => (block as { id: string }).id)).toEqual(["p1", "b2", "b3"]);
  });

  it("descend dans les enfants", () => {
    const toggle = { ...para("t", "dépliant"), children: [owner("b1", "pg_a"), para("p2", "reste")] };
    const { body, removed } = withoutOwnerBlocks([toggle], "pg_a");
    expect(removed).toBe(1);
    expect((body[0] as { children: { id: string }[] }).children.map((block) => block.id)).toEqual(["p2"]);
  });

  it("laisse un paragraphe vide dans une colonne vidée", () => {
    const columns = {
      id: "cl",
      type: "columnList",
      props: {},
      children: [
        { id: "c1", type: "column", props: {}, children: [owner("b1", "pg_a")] },
        { id: "c2", type: "column", props: {}, children: [para("p", "x")] },
      ],
    };
    const { body } = withoutOwnerBlocks([columns], "pg_a");
    const first = (body[0] as { children: { children: { id: string; type: string }[] }[] }).children[0].children;
    expect(first).toEqual([{ id: "b1", type: "paragraph", props: {}, content: [], children: [] }]);
  });

  it("laisse un paragraphe vide dans un corps vidé", () => {
    const { body } = withoutOwnerBlocks([owner("b1", "pg_a")], "pg_a");
    expect(body).toEqual([{ id: "b1", type: "paragraph", props: {}, content: [], children: [] }]);
  });

  it("ne touche à rien sans bloc propriétaire", () => {
    const start = [para("p1", "x"), link("b2", "pg_a")];
    const { body, removed } = withoutOwnerBlocks(start, "pg_a");
    expect(removed).toBe(0);
    expect(body).toEqual(start);
  });
});

describe("renderHtml, identifiants de bloc", () => {
  const withId = (id: string, type: string, content: unknown = [], props: Record<string, unknown> = {}, children: unknown[] = []) => ({
    id,
    ...block(type, content, props, children),
  });

  it("ne pose aucun id sans l'option (la vitrine rend plusieurs corps dans une page)", () => {
    expect(renderHtml([withId("b1", "paragraph", [text("a")])])).toBe("<p>a</p>");
  });

  it("pose l'id du bloc sur son élément quand l'option est active", () => {
    const body = [withId("b1", "paragraph", [text("a")]), withId("b2", "heading", [text("T")], { level: 1 })];
    expect(renderHtml(body, { blockIds: true })).toBe('<p id="b1">a</p><h2 id="b2">T</h2>');
  });

  it("garde les classes d'alignement et de couleur", () => {
    const body = [withId("b1", "paragraph", [text("a")], { textAlignment: "center" })];
    expect(renderHtml(body, { blockIds: true })).toBe('<p id="b1" class="align-center">a</p>');
  });

  it("pose l'id de chaque élément d'une liste sur son <li>, pas sur la liste", () => {
    const body = [withId("l1", "bulletListItem", [text("un")]), withId("l2", "bulletListItem", [text("deux")])];
    expect(renderHtml(body, { blockIds: true })).toBe('<ul><li id="l1">un</li><li id="l2">deux</li></ul>');
  });

  it("atteint les blocs enfants", () => {
    const body = [withId("b1", "paragraph", [text("père")], {}, [withId("b2", "paragraph", [text("fils")])])];
    expect(renderHtml(body, { blockIds: true })).toBe('<p id="b1">père</p><div class="block-children"><p id="b2">fils</p></div>');
  });

  it("pose l'id sur un séparateur et un bloc dépliable", () => {
    expect(renderHtml([withId("d1", "divider")], { blockIds: true })).toBe('<hr id="d1">');
    const toggle = withId("t1", "toggleListItem", [text("titre")], {}, [withId("t2", "paragraph", [text("dedans")])]);
    expect(renderHtml([toggle], { blockIds: true })).toBe('<details id="t1"><summary>titre</summary><p id="t2">dedans</p></details>');
  });

  it("ignore un bloc sans id ou dont l'id est douteux", () => {
    const body = [block("paragraph", [text("a")]), withId('x"y', "paragraph", [text("b")])];
    expect(renderHtml(body, { blockIds: true })).toBe("<p>a</p><p>b</p>");
  });

  it("ne rend toujours rien pour un bloc qui ne rend rien", () => {
    const box = { id: "c1", type: "conflict", props: {}, children: [] };
    expect(renderHtml([box], { blockIds: true })).toBe("");
  });
});
