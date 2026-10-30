"use client";
// Un élément de l'arbre : à la fois saisissable (on le déplace) et cible (on
// dépose une autre page dessus pour l'y ranger). Une sous-page naît du menu
// « / » de sa mère, pas d'ici.
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { label, type TreeNode } from "@/lib/tree";

// Au-delà, l'indentation cesse de croître : l'arbre reste lisible.
const MAX_INDENT_DEPTH = 6;

type Props = {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

export function TreeItem({ node, depth, activeId, expanded, onToggle }: Props) {
  const drag = useDraggable({ id: node.id });
  const drop = useDroppable({ id: node.id, disabled: node.type !== "page" });
  const open = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const href = node.type === "database" ? `/db/${node.id}` : `/page/${node.id}`;

  const classes = ["tree-row"];
  if (node.id === activeId) classes.push("active");
  if (drop.isOver && !drag.isDragging) classes.push("drop-target");
  if (drag.isDragging) classes.push("dragging");

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={node.id === activeId}>
      <div
        ref={(element) => {
          drag.setNodeRef(element);
          drop.setNodeRef(element);
        }}
        className={classes.join(" ")}
        style={{ paddingLeft: `${Math.min(depth, MAX_INDENT_DEPTH) * 14 + 4}px` }}
        {...drag.attributes}
        {...drag.listeners}
      >
        <button
          type="button"
          className="chevron"
          aria-label={open ? "Replier" : "Déplier"}
          onClick={() => onToggle(node.id)}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? "▾" : "▸") : "•"}
        </button>
        <Link href={href} className="tree-link">
          {label(node)}
        </Link>
      </div>
      {open && hasChildren && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
