"use client";
// Une carte Kanban : saisissable (on la déplace) et cible (on dépose une
// autre carte dessus, avant ou après elle). Le trait de dépôt montre la place
// qui sera prise. Le titre s'édite sur place : Entrée ou perte du focus
// enregistre, Échap annule. ↗ ouvre la page complète.
// La poignée ⠿ déplace la carte, pour que le champ de titre garde la sélection
// de texte et le clic.
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { useRef, useState } from "react";
import { normalizeValue, type EntryRow, type Property } from "@/lib/properties";
import { PageIcon } from "./PageIcon";
import { ValueView } from "./propertyUi";

type Props = {
  entry: EntryRow;
  properties: Property[];
  groupId: string;
  hint: "before" | "after" | null;
  onRename: (entryId: string, title: string) => Promise<boolean>;
};

export function KanbanCard({ entry, properties, groupId, hint, onRename }: Props) {
  const drag = useDraggable({ id: entry.id });
  const drop = useDroppable({ id: entry.id });
  const [draft, setDraft] = useState(entry.title);
  const [synced, setSynced] = useState(entry.title);
  const cancelling = useRef(false);
  // Un titre changé ailleurs (synchronisation) repose dans le champ.
  if (entry.title !== synced) {
    setSynced(entry.title);
    setDraft(entry.title);
  }

  const classes = ["board-card"];
  if (hint) classes.push(hint === "before" ? "drop-before" : "drop-after");
  if (drag.isDragging) classes.push("dragging");

  // Une valeur vide ne fait pas une ligne : seule la donnée saisie s'affiche.
  const fields = properties.filter(
    (prop) => prop.id !== groupId && normalizeValue(prop, entry.values[prop.id]) !== undefined,
  );

  async function commit() {
    if (cancelling.current) {
      cancelling.current = false;
      setDraft(entry.title);
      return;
    }
    const next = draft.trim();
    if (next === entry.title.trim()) return;
    const ok = await onRename(entry.id, next);
    if (!ok) setDraft(entry.title);
  }

  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        drop.setNodeRef(element);
      }}
      className={classes.join(" ")}
    >
      <div className="board-card-head">
        <button
          type="button"
          className="board-card-handle"
          aria-label={`Déplacer ${entry.title || "la carte"}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          ⠿
        </button>
        <PageIcon icon={entry.icon} />
        <textarea
          className="board-card-input"
          rows={1}
          value={draft}
          placeholder="Sans titre"
          aria-label="Titre de l'entrée"
          onChange={(event) => setDraft(event.target.value.replace(/\s*\n\s*/g, " "))}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              cancelling.current = true;
              setDraft(entry.title);
              event.currentTarget.blur();
            }
          }}
        />
        <Link
          href={`/page/${entry.id}`}
          className="board-card-open"
          aria-label={`Ouvrir ${entry.title || "l'entrée"}`}
          title="Ouvrir l'entrée"
          draggable={false}
        >
          ↗
        </Link>
      </div>
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
