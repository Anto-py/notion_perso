"use client";
// Un élément de l'arbre : à la fois saisissable (on le déplace) et cible (on
// dépose une autre page dessus pour l'y ranger). Une sous-page naît du menu
// « / » de sa mère, pas d'ici ; « Bases » et ses dossiers ont un « + » qui
// crée une base ou un dossier (étape 16).
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { useState } from "react";
import type { TreeNode } from "@/lib/tree";
import { PageLabel } from "./PageIcon";

// Au-delà, l'indentation cesse de croître : l'arbre reste lisible.
const MAX_INDENT_DEPTH = 6;

type Props = {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onCreate: (type: "database" | "folder", parentId: string) => void;
};

function hrefOf(node: TreeNode): string {
  if (node.inbox) return "/inbox";
  return node.type === "database" ? `/db/${node.id}` : `/page/${node.id}`;
}

export function TreeItem({ node, depth, activeId, expanded, onToggle, onCreate }: Props) {
  // « Bases » ne se déplace pas ; une page ou un dossier reçoit un dépôt, le
  // tri entre les deux est fait par placementError au lâcher.
  const drag = useDraggable({ id: node.id, disabled: node.basesRoot });
  const drop = useDroppable({ id: node.id, disabled: node.type !== "page" && node.type !== "folder" });
  const [menu, setMenu] = useState(false);
  const open = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const href = hrefOf(node);

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
        // Pas d'attributs de glisser sur « Bases » : dnd-kit y poserait
        // aria-disabled, que le lecteur d'écran étend au lien et au « + ».
        {...(node.basesRoot ? {} : { ...drag.attributes, ...drag.listeners })}
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
          <PageLabel row={node} />
          {node.closed && (
            <span className="tree-lock" title="Exclue du partage" aria-label="Exclue du partage">
              🔒
            </span>
          )}
        </Link>
        {node.type === "folder" && (
          <span className="tree-add">
            <button
              type="button"
              className="tree-add-toggle"
              aria-label={`Ajouter dans ${node.title || "Sans titre"}`}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              +
            </button>
            {menu && (
              <span className="tree-add-menu" role="menu">
                {(["database", "folder"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onCreate(type, node.id);
                    }}
                  >
                    {type === "database" ? "Base" : "Dossier"}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
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
              onCreate={onCreate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
