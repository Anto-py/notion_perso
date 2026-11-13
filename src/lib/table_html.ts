// Rendu HTML d'un bloc tableau pour la vue publique et les aperçus.
//
// Les en-têtes se lisent dans `headerRows` et `headerCols` du contenu du
// tableau (BlockNote : activés par `tables: { headers: true }`, posés aussi par
// les imports Notion). Pur : le rendu du contenu d'une cellule est injecté,
// `inlineHtml` vivant dans blocks.ts.

type Json = unknown;
type Obj = Record<string, Json>;

const isObject = (value: Json): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

// Un nombre d'en-têtes est un entier positif ; tout le reste vaut zéro.
function headerCount(value: Json): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 0;
}

// Une cellule est soit un objet `tableCell`, soit la liste de contenu en ligne
// d'un ancien enregistrement.
const cellContent = (cell: Json): Json => (isObject(cell) ? cell.content : cell);

export function tableHtml(content: Obj, inline: (content: Json) => string): string {
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const headRows = Math.min(headerCount(content.headerRows), rows.length);
  const headCols = headerCount(content.headerCols);

  const line = (row: Json, r: number) => {
    const cells = isObject(row) && Array.isArray(row.cells) ? row.cells : [];
    const html = cells
      .map((cell, c) => {
        const inner = inline(cellContent(cell));
        if (r < headRows) return `<th scope="col">${inner}</th>`;
        if (c < headCols) return `<th scope="row">${inner}</th>`;
        return `<td>${inner}</td>`;
      })
      .join("");
    return `<tr>${html}</tr>`;
  };

  const head = rows.slice(0, headRows).map((row, r) => line(row, r)).join("");
  const body = rows.slice(headRows).map((row, i) => line(row, i + headRows)).join("");
  return `<table class="body-table">${head ? `<thead>${head}</thead>` : ""}<tbody>${body}</tbody></table>`;
}
