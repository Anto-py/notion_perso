// Copie de blocs pour « Dupliquer » du menu de bloc (étape 21, palier a).
//
// Pure : l'identifiant neuf vient d'un générateur injecté (crypto.randomUUID
// dans le navigateur, un compteur dans les tests). La copie ne partage aucune
// référence avec l'original, enfants compris.

import { SUBPAGE_BLOCK } from "./blocks.ts";

// Forme minimale d'un bloc BlockNote, assez lâche pour que le composant y
// passe `editor.document` après un simple transtypage.
export type DupBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: DupBlock[];
};

// Un bloc de sous-page propriétaire (link faux) dupliqué deviendrait un second
// propriétaire : useSubpages jette la page en corbeille quand le dernier bloc
// propriétaire disparaît, donc supprimer la copie jetterait la vraie page. La
// copie est un lien, sans pouvoir sur la page.
function copiedProps(block: DupBlock): Record<string, unknown> {
  const props = structuredClone(block.props ?? {});
  return block.type === SUBPAGE_BLOCK ? { ...props, link: true } : props;
}

export function duplicateBlocks(blocks: readonly DupBlock[], makeId: () => string): DupBlock[] {
  return blocks.map((block) => {
    const copy: DupBlock = {
      id: makeId(),
      type: block.type,
      props: copiedProps(block),
      children: duplicateBlocks(block.children ?? [], makeId),
    };
    if (block.content !== undefined) copy.content = structuredClone(block.content);
    return copy;
  });
}
