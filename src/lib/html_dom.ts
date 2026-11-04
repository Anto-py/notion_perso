// Petites aides sur l'arbre parse5, partagées par le lecteur d'export HTML.
// Module pur : aucun accès au disque ni à Next.
import type { DefaultTreeAdapterTypes } from "parse5";

export type DomNode = DefaultTreeAdapterTypes.Node;
export type DomElement = DefaultTreeAdapterTypes.Element;
export type DomText = DefaultTreeAdapterTypes.TextNode;

export function isElement(node: DomNode): node is DomElement {
  return (node as DomElement).tagName !== undefined;
}

export function isText(node: DomNode): node is DomText {
  return (node as DomText).value !== undefined;
}

export function tagName(node: DomNode): string {
  return isElement(node) ? node.tagName.toLowerCase() : "";
}

export function attr(node: DomNode, name: string): string | null {
  if (!isElement(node)) return null;
  const found = node.attrs.find((item) => item.name === name);
  return found ? found.value : null;
}

export function classes(node: DomNode): string[] {
  const value = attr(node, "class");
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

export function hasClass(node: DomNode, name: string): boolean {
  return classes(node).includes(name);
}

type DomParent = DefaultTreeAdapterTypes.ParentNode;

function isParent(node: DomNode): node is DomParent {
  return "childNodes" in node;
}

export function children(node: DomNode): DomNode[] {
  return isParent(node) ? node.childNodes : [];
}

export function elements(node: DomNode): DomElement[] {
  return children(node).filter(isElement);
}

export function firstElement(node: DomNode, predicate: (element: DomElement) => boolean): DomElement | null {
  for (const child of elements(node)) {
    if (predicate(child)) return child;
    const found = firstElement(child, predicate);
    if (found) return found;
  }
  return null;
}

export function allElements(node: DomNode, predicate: (element: DomElement) => boolean): DomElement[] {
  const found: DomElement[] = [];
  for (const child of elements(node)) {
    if (predicate(child)) found.push(child);
    found.push(...allElements(child, predicate));
  }
  return found;
}

export function textContent(node: DomNode): string {
  if (isText(node)) return node.value;
  return children(node).map(textContent).join("");
}

export function normalizeSpace(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// Style inline : « object-position:center 3.04% ; color: red » → la valeur.
export function styleValue(style: string | null, property: string): string | null {
  if (!style) return null;
  for (const item of style.split(";")) {
    const [key, ...rest] = item.split(":");
    if (key?.trim().toLowerCase() === property) return rest.join(":").trim();
  }
  return null;
}
