// Arbre de la sauvegarde ouverte : les mêmes pages que la barre latérale,
// sans geste possible. Une base se lit en ouvrant sa page ; ses entrées ne
// figurent pas ici, comme dans la sidebar de l'app.
import Link from "next/link";
import { buildTree, type TreeNode, type TreeRow } from "@/lib/tree";
import { PageLabel } from "../PageIcon";

export function BackupTree({ rows }: { rows: TreeRow[] }) {
  const tree = buildTree(rows);
  if (!tree.length) return <p className="hint">Cette sauvegarde ne contient aucune page.</p>;
  return (
    <nav className="backup-tree" aria-label="Arbre de la sauvegarde">
      <ul>
        {tree.map((node) => (
          <BackupTreeItem key={node.id} node={node} />
        ))}
      </ul>
    </nav>
  );
}

function BackupTreeItem({ node }: { node: TreeNode }) {
  const row = { id: node.id, title: node.title, icon: node.icon, type: node.type };
  return (
    <li>
      <Link href={`/sauvegarde/${node.id}`} className="backup-tree-link">
        <PageLabel row={row} mediaBase="/api/sauvegarde/media/" />
      </Link>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <BackupTreeItem key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
