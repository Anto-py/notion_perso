"use client";
// Vue Kanban : une colonne par option de la propriété de regroupement, plus
// une « Sans … » pour les entrées sans valeur. Déposer une carte dans une
// autre colonne change sa valeur ; la déposer devant, derrière ou en fin de
// colonne change en plus l'ordre manuel, global à la base.
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { boardOrder, groupEntries, NO_COLUMN, type Column, type EntryRow, type Property, type Value, type Values } from "@/lib/properties";
import { KanbanCard } from "./KanbanCard";
import { OptionChip } from "./propertyUi";

// Les colonnes sont aussi des cibles (dépôt en fin de colonne) : ce préfixe
// les distingue des cartes, dont l'id est celui de l'entrée.
const COLUMN_PREFIX = "col:";

type Props = {
  groupProp: Property;
  properties: Property[]; // affichées dans la vue (hors propriétés masquées)
  hiddenKeys: string[]; // colonnes masquées pour cette propriété de regroupement
  entries: EntryRow[]; // visibles, dans l'ordre manuel
  allIds: string[]; // toutes les entrées de la base, masquées comprises
  onCreate: (values: Values) => void;
  onMove: (entryId: string, value: Value | null, order: string[]) => Promise<void>;
};

type Hint = { id: string; before: boolean };

// Une carte passe avant les cibles qu'elle touche : sans cela, le dépôt sur
// une carte serait toujours capté par la colonne qui la contient.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((hit) => !String(hit.id).startsWith(COLUMN_PREFIX));
  if (card) return [card];
  const column = hits.find((hit) => String(hit.id).startsWith(COLUMN_PREFIX));
  return column ? [column] : hits.length > 0 ? hits : closestCenter(args);
};

export function KanbanView({ groupProp, properties, hiddenKeys, entries, allIds, onCreate, onMove }: Props) {
  const columns = useMemo(() => {
    const hidden = new Set(hiddenKeys);
    return groupEntries(entries, groupProp).filter((column) => !hidden.has(column.key ?? NO_COLUMN));
  }, [entries, groupProp, hiddenKeys]);
  const columnOf = useMemo(() => new Map(columns.flatMap((column) => column.entries.map((e) => [e.id, column.key] as const))), [columns]);

  const [dragging, setDragging] = useState<EntryRow | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);

  // Comme la sidebar : un léger déplacement avant de saisir, un appui maintenu
  // au doigt pour laisser défiler la page.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(entries.find((entry) => entry.id === String(event.active.id)) ?? null);
  }

  function onDragOver(event: DragOverEvent) {
    // Le pointeur bouge à chaque frame : ne re-rendre que si le trait change.
    const next = hintOf(event);
    setHint((current) => (current?.id === next?.id && current?.before === next?.before ? current : next));
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    setHint(null);
    const { active, over } = event;
    if (!over || over.id === active.id) return;

    const movedId = String(active.id);
    const overId = String(over.id);
    const onColumn = overId.startsWith(COLUMN_PREFIX);
    if (!onColumn && !columnOf.has(overId)) return;
    const targetKey = onColumn ? overId.slice(COLUMN_PREFIX.length) || null : (columnOf.get(overId) ?? null);

    // Au relâchement, la position de la souris a pu quitter la cible : le
    // dernier trait affiché fait foi, sinon la fin de colonne.
    const place = onColumn ? null : (hintOf(event) ?? hint);
    const where = place ? (place.before ? { before: overId } : { after: overId }) : { end: true as const };
    const order = boardOrder(allIds, columns, movedId, targetKey, where);
    const target = columns.find((column) => column.key === targetKey);
    if (!target) return;

    const sameOrder = order.length === allIds.length && order.every((id, index) => id === allIds[index]);
    if (sameOrder && targetKey === (columnOf.get(movedId) ?? null)) return;
    await onMove(movedId, target.value, order);
  }

  return (
    <DndContext
      // id explicite : voir Sidebar.tsx (identifiant d'accessibilité stable
      // entre rendu serveur et rendu client).
      id="board-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setHint(null);
      }}
    >
      {columns.length === 0 ? (
        <p className="hint">Toutes les colonnes sont masquées. Réaffichez-en une dans « Colonnes du Kanban ».</p>
      ) : (
        <div className="board">
          {columns.map((column) => (
            <BoardColumn
              key={column.key ?? "none"}
              column={column}
              groupProp={groupProp}
              properties={properties}
              hint={hint}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="board-card drag-overlay-card">
            {dragging.icon ?? "📄"} {dragging.title || "Sans titre"}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Avant ou après la cible, selon le centre de la carte tirée.
function hintOf(event: DragOverEvent | DragEndEvent): Hint | null {
  const { active, over } = event;
  if (!over || over.id === active.id) return null;
  const id = String(over.id);
  if (id.startsWith(COLUMN_PREFIX)) return null;
  const rect = active.rect.current.translated;
  return { id, before: rect ? rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2 : true };
}

type ColumnProps = {
  column: Column;
  groupProp: Property;
  properties: Property[];
  hint: Hint | null;
  onCreate: (values: Values) => void;
};

function BoardColumn({ column, groupProp, properties, hint, onCreate }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${column.key ?? ""}` });
  const create = () => onCreate(column.value === null ? {} : { [groupProp.id]: column.value });

  return (
    <section ref={setNodeRef} className={isOver ? "board-column over" : "board-column"} aria-label={column.name}>
      <header className="board-column-head">
        {column.color ? <OptionChip option={{ name: column.name, color: column.color }} /> : <span className="board-column-name">{column.name}</span>}
        <span className="board-count">{column.entries.length}</span>
        <button type="button" className="ghost board-add" aria-label={`Nouvelle entrée dans « ${column.name} »`} onClick={create}>
          +
        </button>
      </header>
      <div className="board-cards">
        {column.entries.map((entry) => (
          <KanbanCard
            key={entry.id}
            entry={entry}
            properties={properties}
            groupId={groupProp.id}
            hint={hint?.id === entry.id ? (hint.before ? "before" : "after") : null}
          />
        ))}
      </div>
    </section>
  );
}
