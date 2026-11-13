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
  useExtensionState,
  type SideMenuProps,
} from "@blocknote/react";
import type { ReactNode } from "react";
import { duplicateBlocks, type DupBlock } from "@/lib/block_duplicate";

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

function BlockDragHandleMenu() {
  const dictionary = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dictionary.drag_handle.delete_menuitem}</RemoveBlockItem>
      <DuplicateBlockItem>Dupliquer</DuplicateBlockItem>
      <BlockColorsItem>{dictionary.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dictionary.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dictionary.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

// À passer à <SideMenuController sideMenu={BlockSideMenu} />.
export function BlockSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={BlockDragHandleMenu} />;
}
