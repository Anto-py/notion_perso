// Capture rapide : un texte libre devient le titre et le corps d'une entrée
// du Vide-cerveau. Module pur, sans base ni réseau.
import { flattenToText } from "./blocks";

export const CAPTURE_TITLE_MAX = 200;

// Un bloc paragraphe au format BlockNote. L'identifiant est tiré ici pour que
// le rendu serveur et la relecture par l'éditeur tombent sur le même bloc.
function paragraph(text: string) {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", textAlignment: "left", backgroundColor: "default" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

export type CapturedNote = { title: string; body: unknown[]; bodyText: string };

// Le titre est la première ligne, le corps reprend toutes les lignes non
// vides. Un texte vide donne une note intitulée « Note » : la capture ne
// doit jamais refuser un geste, l'entrée se complète ensuite.
export function noteFromText(raw: string): CapturedNote {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = lines[0] ?? "";
  const title = first.length > CAPTURE_TITLE_MAX ? first.slice(0, CAPTURE_TITLE_MAX).trimEnd() : first || "Note";
  const body = lines.map(paragraph);
  return { title, body, bodyText: flattenToText(body) };
}
