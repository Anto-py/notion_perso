"use client";
// Menu de la poignée ⠿ d'un bloc (étape 21). Remplace celui de BlockNote 0.56,
// qui ne portait que Supprimer, Couleurs et les en-têtes de tableau. La poignée
// reste celle de BlockNote : un clic sans mouvement ouvre le menu, un glisser
// réordonne le bloc. Les entrées par défaut ne reçoivent plus de prop `block` :
// elles lisent le bloc visé dans l'état de l'extension du menu latéral, comme
// DuplicateBlockItem ci-dessous.
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  usePortalElement,
  useExtensionState,
  type SideMenuProps,
} from "@blocknote/react";
import type { ReactNode } from "react";
import { duplicateBlocks, type DupBlock } from "@/lib/block_duplicate";
import { transformTargets } from "@/lib/block_transform";
import { useAskBlockMove } from "./BlockMove";

// Ouvre le sélecteur de page, tenu hors du menu (BlockMove.tsx) : le menu de la
// poignée se ferme au clic et emporterait son propre sélecteur.
function MoveBlockItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const ask = useAskBlockMove();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined || !ask) return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => ask(block.id)}>
      {children}
    </Components.Generic.Menu.Item>
  );
}

function DuplicateBlockItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        // Le bloc du menu date du survol : on relit la version du document.
        const current = editor.getBlock(block.id) ?? block;
        const copies = duplicateBlocks([current as unknown as DupBlock], () => crypto.randomUUID());
        editor.insertBlocks(copies as never[], current, "after");
      }}
    >
      {children}
    </Components.Generic.Menu.Item>
  );
}

// Sous-menu des types de texte, sur le motif de BlockColorsItem. Masqué sur un
// bloc qui n'est pas du texte (image, tableau, vue liée…). Le type actuel est
// coché. Le bloc garde texte, styles en ligne et enfants : seul le type change,
// et Cmd + Z rend l'original (updateBlock passe par l'historique de l'éditeur).
function TransformBlockItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!;
  const portal = usePortalElement();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined) return null;
  const choices = transformTargets(block.type, block.props as Record<string, unknown>);
  if (choices.length === 0) return null;
  const apply = (choice: (typeof choices)[number]) => {
    // Le bloc du menu date du survol : on relit la version du document.
    const current = editor.getBlock(block.id) ?? block;
    editor.updateBlock(current, { type: choice.type, props: choice.props } as never);
  };
  return (
    <Components.Generic.Menu.Root position="right" sub portalElement={portal}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {choices.map((choice) => (
          <Components.Generic.Menu.Item key={choice.key} className="bn-menu-item" checked={choice.current} onClick={() => apply(choice)}>
            {choice.label}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

function BlockDragHandleMenu() {
  const dictionary = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dictionary.drag_handle.delete_menuitem}</RemoveBlockItem>
      <MoveBlockItem>Déplacer vers…</MoveBlockItem>
      <DuplicateBlockItem>Dupliquer</DuplicateBlockItem>
      <BlockColorsItem>{dictionary.drag_handle.colors_menuitem}</BlockColorsItem>
      <TransformBlockItem>Transformer en</TransformBlockItem>
      <TableRowHeaderItem>{dictionary.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dictionary.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

// À passer à <SideMenuController sideMenu={BlockSideMenu} />.
export function BlockSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={BlockDragHandleMenu} />;
}
