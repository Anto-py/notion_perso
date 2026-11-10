// Mention : un contenu en ligne BlockNote qui tient une adresse et son titre.
// Module pur, partagé par la capture, l'éditeur et le rendu HTML.

export type Mention = { url: string; title: string };

// Les propriétés d'une mention arrivée du navigateur : on ignore tout le
// reste, une adresse vide ne fait pas une mention.
export function mentionProps(raw: unknown): Mention | null {
  if (typeof raw !== "object" || raw === null) return null;
  const props = raw as Record<string, unknown>;
  const url = typeof props.url === "string" ? props.url.trim() : "";
  if (!url) return null;
  const title = typeof props.title === "string" ? props.title.trim() : "";
  return { url, title };
}

export function mentionNode(url: string, title: string): Record<string, unknown> {
  return { type: "mention", props: { url, title } };
}
