import { describe, expect, it } from "vitest";
import { renderHtml } from "@/lib/blocks";
import { tableHtml } from "@/lib/table_html";

// Rend le texte d'une cellule tel quel : ces tests regardent la structure.
const plain = (content: unknown) => (Array.isArray(content) ? content.map((item: { text?: string }) => item.text ?? "").join("") : "");
const t = (text: string) => [{ type: "text", text, styles: {} }];
// Les deux formes de cellule que le corps peut porter : la liste de contenu en
// ligne d'un ancien enregistrement, et l'objet `tableCell` de BlockNote 0.56.
const cell = (text: string) => ({ type: "tableCell", props: {}, content: t(text) });
const rows = (grid: string[][]) => grid.map((line) => ({ cells: line.map(cell) }));

describe("tableHtml", () => {
  it("sans en-tête : un seul tbody de cellules td, comme avant", () => {
    const html = tableHtml({ type: "tableContent", rows: rows([["A", "B"], ["1", "2"]]) }, plain);
    expect(html).toBe('<table class="body-table"><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>');
  });

  it("une ligne d'en-tête : thead en th de colonne, le reste en td", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 1, rows: rows([["A", "B"], ["1", "2"]]) }, plain);
    expect(html).toBe(
      '<table class="body-table"><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead>' +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  it("une colonne d'en-tête : la première cellule de chaque ligne en th de ligne, sans thead", () => {
    const html = tableHtml({ type: "tableContent", headerCols: 1, rows: rows([["A", "B"], ["1", "2"]]) }, plain);
    expect(html).toBe(
      '<table class="body-table"><tbody><tr><th scope="row">A</th><td>B</td></tr><tr><th scope="row">1</th><td>2</td></tr></tbody></table>',
    );
  });

  it("les deux : le coin reste un en-tête de colonne, les autres lignes ont leur en-tête de ligne", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 1, headerCols: 1, rows: rows([["", "B"], ["1", "2"]]) }, plain);
    expect(html).toBe(
      '<table class="body-table"><thead><tr><th scope="col"></th><th scope="col">B</th></tr></thead>' +
        '<tbody><tr><th scope="row">1</th><td>2</td></tr></tbody></table>',
    );
  });

  it("plusieurs lignes d'en-tête vont toutes dans le thead", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 2, rows: rows([["A"], ["B"], ["c"]]) }, plain);
    expect(html).toContain('<thead><tr><th scope="col">A</th></tr><tr><th scope="col">B</th></tr></thead>');
    expect(html).toContain("<tbody><tr><td>c</td></tr></tbody>");
  });

  it("borne un nombre de lignes d'en-tête trop grand au nombre de lignes", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 9, rows: rows([["A"], ["B"]]) }, plain);
    expect(html).toBe(
      '<table class="body-table"><thead><tr><th scope="col">A</th></tr><tr><th scope="col">B</th></tr></thead><tbody></tbody></table>',
    );
  });

  it("ignore une valeur d'en-tête qui n'est pas un entier positif", () => {
    const plainTable = '<table class="body-table"><tbody><tr><td>A</td></tr></tbody></table>';
    for (const bad of [undefined, null, -1, 0, "1", NaN, Infinity, {}, [1], true]) {
      expect(tableHtml({ type: "tableContent", headerRows: bad as never, headerCols: bad as never, rows: rows([["A"]]) }, plain)).toBe(plainTable);
    }
  });

  it("arrondit un nombre à virgule vers le bas", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 1.9, rows: rows([["A"], ["B"]]) }, plain);
    expect(html).toContain('<thead><tr><th scope="col">A</th></tr></thead>');
    expect(html).toContain("<tbody><tr><td>B</td></tr></tbody>");
  });

  it("lit aussi la cellule en simple liste de contenu en ligne", () => {
    const html = tableHtml({ type: "tableContent", headerRows: 1, rows: [{ cells: [t("A"), t("B")] }, { cells: [t("1"), t("2")] }] }, plain);
    expect(html).toContain('<th scope="col">A</th><th scope="col">B</th>');
    expect(html).toContain("<td>1</td><td>2</td>");
  });

  it("ne plante pas sur des lignes ou des cellules absentes ou mal formées", () => {
    expect(tableHtml({ type: "tableContent" }, plain)).toBe('<table class="body-table"><tbody></tbody></table>');
    expect(tableHtml({ type: "tableContent", rows: [null, 3, { cells: "x" }, { cells: [null] }] as never }, plain)).toBe(
      '<table class="body-table"><tbody><tr></tr><tr></tr><tr></tr><tr><td></td></tr></tbody></table>',
    );
  });
});

describe("renderHtml, tableau", () => {
  const body = (extra: Record<string, unknown>) => [
    { id: "t", type: "table", props: {}, content: { type: "tableContent", ...extra, rows: rows([["<b>A</b>", "B"], ["1", "2"]]) }, children: [] },
  ];

  it("rend les en-têtes en th et échappe le contenu des cellules", () => {
    const html = renderHtml(body({ headerRows: 1 }));
    expect(html).toContain('<thead><tr><th scope="col">&lt;b&gt;A&lt;/b&gt;</th><th scope="col">B</th></tr></thead>');
    expect(html).toContain("<tbody><tr><td>1</td><td>2</td></tr></tbody>");
  });

  it("un tableau sans en-tête garde son rendu d'avant", () => {
    expect(renderHtml(body({}))).toBe(
      '<table class="body-table"><tbody><tr><td>&lt;b&gt;A&lt;/b&gt;</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
  });
});
