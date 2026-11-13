// Cibles de « Transformer en » du menu de bloc (étape 21, palier b).
//
// Pure : le composant lit le bloc visé, demande les cibles, puis appelle
// editor.updateBlock(bloc, { type, props }). Texte, styles en ligne et
// sous-blocs restent en place, seul le type change.

export type TransformTarget = {
  key: string;
  label: string;
  type: string;
  props?: Record<string, unknown>;
};

export type TransformChoice = TransformTarget & { current: boolean };

// Dans l'ordre du menu. Les libellés reprennent ceux du menu « / » de
// BlockNote en français, pour qu'un même bloc porte le même nom partout.
const TARGETS: readonly TransformTarget[] = [
  { key: "paragraph", label: "Paragraphe", type: "paragraph" },
  { key: "heading-1", label: "Titre 1", type: "heading", props: { level: 1 } },
  { key: "heading-2", label: "Titre 2", type: "heading", props: { level: 2 } },
  { key: "heading-3", label: "Titre 3", type: "heading", props: { level: 3 } },
  { key: "bulletListItem", label: "Liste à puces", type: "bulletListItem" },
  { key: "numberedListItem", label: "Liste numérotée", type: "numberedListItem" },
  { key: "checkListItem", label: "Liste de tâches", type: "checkListItem" },
  { key: "toggleListItem", label: "Liste repliable", type: "toggleListItem" },
  { key: "quote", label: "Citation", type: "quote" },
  { key: "codeBlock", label: "Bloc de code", type: "codeBlock" },
];

// Un titre n'est pas un type à part : c'est `heading` plus un niveau.
function isCurrent(target: TransformTarget, type: string, props?: Record<string, unknown>): boolean {
  if (target.type !== type) return false;
  if (type !== "heading") return true;
  return target.props?.level === props?.level;
}

// Vide pour tout bloc qui n'est pas du texte (image, tableau, vue liée,
// colonnes…) : le composant masque alors l'entrée.
export function transformTargets(type: string, props?: Record<string, unknown>): TransformChoice[] {
  if (!TARGETS.some((target) => target.type === type)) return [];
  return TARGETS.map((target) => ({
    ...target,
    ...(target.props ? { props: { ...target.props } } : {}),
    current: isCurrent(target, type, props),
  }));
}
