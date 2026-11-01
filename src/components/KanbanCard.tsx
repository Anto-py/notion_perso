"use client";
// Une carte Kanban : saisissable (on la déplace) et cible (on dépose une
// autre carte dessus, avant ou après elle). Le trait de dépôt montre la place
// qui sera prise. Un clic sans déplacement ouvre l'entrée.
// Sous le titre, les valeurs des propriétés affichées dans la vue, sauf celle
// qui fait les colonnes. Une propriété masquée par « Champs des cartes » ne
// figure pas dans properties.
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { normalizeValue, type EntryRow, type Property } from "@/lib/properties";
import { PageLabel } from "./PageIcon";
import { ValueView } from "./propertyUi";

type Props = { entry: EntryRow; properties: Property[]; groupId: string; hint: "before" | "after" | null };

export function KanbanCard({ entry, properties, groupId, hint }: Props) {
  const drag = useDraggable({ id: entry.id });
  const drop = useDroppable({ id: entry.id });

  const classes = ["board-card"];
  if (hint) classes.push(hint === "before" ? "drop-before" : "drop-after");
  if (drag.isDragging) classes.push("dragging");

  // Une valeur vide ne fait pas une ligne : seule la donnée saisie s'affiche.
  const fields = properties.filter(
    (prop) => prop.id !== groupId && normalizeValue(prop, entry.values[prop.id]) !== undefined,
  );

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
        <PageLabel row={entry} />
      </Link>
      {fields.length > 0 && (
        <dl className="board-card-fields">
          {fields.map((prop) => (
            <div className="board-card-field" key={prop.id}>
              <dt>{prop.name}</dt>
              <dd>
                <ValueView prop={prop} value={entry.values[prop.id]} links={entry.links?.[prop.id]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
