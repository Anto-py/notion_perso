// Capture rapide : un texte libre devient un bloc, une adresse seule une
// mention en ligne. Module pur, sans base ni réseau.
import { mentionNode } from "./mention.ts";
import { bareUrlsInText } from "./mention_links.ts";

export const CAPTURE_TITLE_MAX = 200;

const WITH_SCHEME = /^https?:\/\/\S+$/i;
// Un domaine seul, avec un chemin et un port facultatifs. Le point final d'une
// phrase ne suffit pas : le dernier segment doit être alphabétique.
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/\S*)?$/i;

export type Capture = { kind: "link"; url: string } | { kind: "note"; text: string };

// Une adresse seule : le champ entier est une URL, avec ou sans schéma. Une
// phrase qui contient une adresse reste une note.
export function parseCapture(raw: string): Capture | null {
  const text = raw.trim();
  if (!text) return null;
  if (WITH_SCHEME.test(text) || DOMAIN.test(text)) return { kind: "link", url: withScheme(text) };
  return { kind: "note", text };
}

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Un bloc paragraphe au format BlockNote. L'identifiant est tiré ici pour que
// le rendu serveur et la relecture par l'éditeur tombent sur le même bloc.
function paragraph(content: unknown[]) {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", textAlignment: "left", backgroundColor: "default" },
    content,
    children: [],
  };
}

// Le texte entier tient dans un seul paragraphe, retours à la ligne compris.
// Une adresse nue y devient une mention (étape 22) ; sans titre connu, le
// domaine s'affiche.
export function noteBlock(text: string, titles: ReadonlyMap<string, string> = new Map()): Record<string, unknown> {
  return paragraph(noteContent(text, titles));
}

function noteContent(text: string, titles: ReadonlyMap<string, string>): unknown[] {
  const spans = bareUrlsInText(text);
  if (!spans.length) return [{ type: "text", text, styles: {} }];
  const content: unknown[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.from > last) content.push({ type: "text", text: text.slice(last, span.from), styles: {} });
    content.push(mentionNode(span.url, titles.get(span.url) ?? ""));
    last = span.to;
  }
  if (last < text.length) content.push({ type: "text", text: text.slice(last), styles: {} });
  return content;
}

// Une adresse seule : un paragraphe qui ne contient que la mention.
export function mentionBlock(url: string, title: string): Record<string, unknown> {
  return paragraph([mentionNode(url, title)]);
}
