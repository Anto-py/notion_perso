"use client";
// Une carte Kanban : saisissable (on la déplace) et cible (on dépose une
// autre carte dessus, avant ou après elle). Le trait de dépôt montre la place
// qui sera prise. Un clic sans déplacement ouvre l'entrée.
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import type { EntryRow } from "@/lib/properties";

type Props = { entry: EntryRow; hint: "before" | "after" | null };

export function KanbanCard({ entry, hint }: Props) {
  const drag = useDraggable({ id: entry.id });
  const drop = useDroppable({ id: entry.id });

  const classes = ["board-card"];
  if (hint) classes.push(hint === "before" ? "drop-before" : "drop-after");
  if (drag.isDragging) classes.push("dragging");

  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        drop.setNodeRef(element);
      }}
      className={classes.join(" ")}
      {...drag.attributes}
      {...drag.listeners}
    >
      <Link href={`/page/${entry.id}`} className="board-card-title" draggable={false}>
        {entry.icon ?? "📄"} {entry.title || "Sans titre"}
      </Link>
    </div>
  );
}
