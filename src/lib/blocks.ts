// Corps BlockNote (jsonb) → texte brut, pour alimenter body_text et donc la
// recherche, et ajout de blocs lors d'un déplacement d'entrée. Le rendu HTML
// de la vue publique viendra ici à l'étape 5.
//
// Le corps arrive du navigateur : on le parcourt sans lui faire confiance,
// chaque champ inattendu est simplement ignoré.
import type { Orphan } from "./properties";

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Contenu en ligne : texte simple, ou lien qui contient lui-même du texte.
function inlineText(content: Json): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isObject(item)) return "";
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "link") return inlineText(item.content);
      return "";
    })
    .join("");
}

// Tableau : rows[].cells[], chaque cellule étant du contenu en ligne, nu ou
// enveloppé dans { type: "tableCell", content }.
function tableText(content: Record<string, Json>): string[] {
  if (!Array.isArray(content.rows)) return [];
  return content.rows.flatMap((row) => {
    if (!isObject(row) || !Array.isArray(row.cells)) return [];
    return row.cells.map((cell) => inlineText(isObject(cell) ? cell.content : cell));
  });
}

function blockLines(block: Json): string[] {
  if (!isObject(block)) return [];
  const lines: string[] = [];
  const { content, props } = block;
  if (isObject(content) && content.type === "tableContent") lines.push(...tableText(content));
  else lines.push(inlineText(content));
  // Nom et légende d'un fichier ou d'une image : retrouver « grille.pdf ».
  if (isObject(props)) {
    for (const key of ["name", "caption"] as const) {
      if (typeof props[key] === "string") lines.push(props[key]);
    }
  }
  if (Array.isArray(block.children)) lines.push(...block.children.flatMap(blockLines));
  return lines;
}

export function flattenToText(body: Json): string {
  if (!Array.isArray(body)) return "";
  return body
    .flatMap(blockLines)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Un paragraphe par valeur orpheline : « URL : » suivi d'un lien cliquable
// pour une adresse, le texte nu pour les autres. Le nom de la propriété reste
// visible, sans quoi la valeur flotterait sans dire d'où elle vient.
function orphanBlock(orphan: Orphan) {
  const content =
    orphan.type === "url"
      ? [
          { type: "text", text: `${orphan.name} : `, styles: {} },
          { type: "link", href: orphan.text, content: [{ type: "text", text: orphan.text, styles: {} }] },
        ]
      : [{ type: "text", text: `${orphan.name} : ${orphan.text}`, styles: {} }];
  return {
    id: globalThis.crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", textAlignment: "left", backgroundColor: "default" },
    content,
    children: [],
  };
}

// Corps d'une entrée déplacée : le corps reçu, suivi des valeurs qui n'ont pas
// trouvé de propriété d'accueil dans la base cible.
export function appendOrphans(body: Json, orphans: readonly Orphan[]): Json[] {
  const blocks: Json[] = Array.isArray(body) ? [...body] : [];
  for (const orphan of orphans) blocks.push(orphanBlock(orphan));
  return blocks;
}
