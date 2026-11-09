"use client";
// Vue Kanban : une colonne par option de la propriété de regroupement, plus
// une « Sans … » pour les entrées sans valeur. Déposer une carte dans une
// autre colonne change sa valeur ; la déposer devant, derrière ou en fin de
// colonne change en plus l'ordre manuel, global à la base. La poignée d'une
// colonne la déplace dans l'ordre propre à la vue ; une colonne repliée
// garde son titre et reçoit les cartes, sans les montrer.
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState, type KeyboardEvent } from "react";
import {
  arrangeColumns,
  boardOrder,
  columnKey,
  groupEntries,
  moveInOrder,
  type Column,
  type EntryRow,
  type OrderPlace,
  type Property,
  type Value,
  type Values,
} from "@/lib/properties";
import type { BoardColumnsPatch } from "@/lib/views";
import { KanbanCard } from "./KanbanCard";
import { PageLabel } from "./PageIcon";
import { OptionChip } from "./propertyUi";

// Les colonnes sont aussi des cibles (dépôt en fin de colonne) : ce préfixe
// les distingue des cartes, dont l'id est celui de l'entrée. La poignée d'une
// colonne porte le second.
const COLUMN_PREFIX = "col:";
const MOVE_PREFIX = "move:";

type Props = {
  groupProp: Property;
  properties: Property[]; // affichées dans la vue (hors propriétés masquées)
  columnOrder: string[]; // ordre propre à la vue, pour cette propriété de regroupement
  hiddenKeys: string[]; // colonnes masquées
  collapsedKeys: string[]; // colonnes repliées
  entries: EntryRow[]; // visibles, dans l'ordre manuel
  allIds: string[]; // toutes les entrées de la base, masquées comprises
  onCreate: (values: Values) => void;
  onMove: (entryId: string, value: Value | null, order: string[]) => Promise<void>;
  onColumns: (patch: BoardColumnsPatch) => void;
};

// id : celui de la carte ou de la colonne (préfixée) visée ; before : le
// trait se place devant (au-dessus d'une carte, à gauche d'une colonne).
type Hint = { id: string; before: boolean };
type Dragging = { card: EntryRow } | { column: Column } | null;

const isColumnTarget = (id: unknown) => String(id).startsWith(COLUMN_PREFIX);
const isColumnDrag = (id: unknown) => String(id).startsWith(MOVE_PREFIX);

// Une colonne tirée ne voit que les colonnes. Une carte passe avant les
// cibles qu'elle touche : sans cela, le dépôt sur une carte serait toujours
// capté par la colonne qui la contient.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (isColumnDrag(args.active.id)) {
    const columns = hits.filter((hit) => isColumnTarget(hit.id));
    return columns.length > 0 ? columns : closestCenter(args).filter((hit) => isColumnTarget(hit.id));
  }
  const card = hits.find((hit) => !isColumnTarget(hit.id));
  if (card) return [card];
  const column = hits.find((hit) => isColumnTarget(hit.id));
  return column ? [column] : hits.length > 0 ? hits : closestCenter(args);
};

export function KanbanView({
  groupProp,
  properties,
  columnOrder,
  hiddenKeys,
  collapsedKeys,
  entries,
  allIds,
  onCreate,
  onMove,
  onColumns,
}: Props) {
  // Toutes les colonnes, masquées comprises, dans l'ordre de la vue : un
  // déplacement réécrit l'ordre complet, pour qu'une colonne masquée garde
  // sa place quand on la réaffiche.
  const allColumns = useMemo(() => arrangeColumns(groupEntries(entries, groupProp), columnOrder), [entries, groupProp, columnOrder]);
  const columns = useMemo(() => {
    const hidden = new Set(hiddenKeys);
    return allColumns.filter((column) => !hidden.has(columnKey(column)));
  }, [allColumns, hiddenKeys]);
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys]);
  const columnOf = useMemo(() => new Map(columns.flatMap((column) => column.entries.map((e) => [e.id, column.key] as const))), [columns]);
  const byTarget = useMemo(() => new Map(columns.map((column) => [COLUMN_PREFIX + columnKey(column), column])), [columns]);

  const [dragging, setDragging] = useState<Dragging>(null);
  const [hint, setHint] = useState<Hint | null>(null);

  // Un léger déplacement avant de saisir à la souris, un appui maintenu au
  // doigt pour laisser défiler la page. MouseSensor et non PointerSensor : un
  // toucher émet aussi un pointerdown, qui précède le touchstart ; le
  // PointerSensor captait donc le doigt avant le TouchSensor, et le défilement
  // du tableau annulait la saisie (pointercancel) avant les 6 px.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function moveColumn(key: string, place: OrderPlace) {
    const keys = allColumns.map(columnKey);
    const next = moveInOrder(keys, key, place);
    if (next.every((item, index) => item === keys[index])) return;
    onColumns({ order: next });
  }

  function toggleCollapsed(key: string) {
    onColumns({ collapsed: collapsed.has(key) ? collapsedKeys.filter((item) => item !== key) : [...collapsedKeys, key] });
  }

  // Flèches gauche et droite sur la poignée : équivalent clavier du glisser,
  // par-dessus la voisine affichée.
  function onHandleKey(event: KeyboardEvent, column: Column) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = columns.indexOf(column);
    const neighbour = columns[event.key === "ArrowLeft" ? index - 1 : index + 1];
    if (!neighbour) return;
    moveColumn(columnKey(column), event.key === "ArrowLeft" ? { before: columnKey(neighbour) } : { after: columnKey(neighbour) });
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (isColumnDrag(id)) {
      const column = columns.find((item) => columnKey(item) === id.slice(MOVE_PREFIX.length));
      setDragging(column ? { column } : null);
    } else {
      const card = entries.find((entry) => entry.id === id);
      setDragging(card ? { card } : null);
    }
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
    const activeId = String(active.id);

    if (isColumnDrag(activeId)) {
      const spot = hintOf(event) ?? hint;
      const target = spot ? byTarget.get(spot.id) : undefined;
      if (!spot || !target) return;
      moveColumn(activeId.slice(MOVE_PREFIX.length), spot.before ? { before: columnKey(target) } : { after: columnKey(target) });
      return;
    }

    const overId = String(over.id);
    const onColumn = isColumnTarget(overId);
    const target = onColumn ? byTarget.get(overId) : columns.find((column) => column.key === (columnOf.get(overId) ?? null));
    if (!target || (!onColumn && !columnOf.has(overId))) return;

    // Au relâchement, la position de la souris a pu quitter la cible : le
    // dernier trait affiché fait foi, sinon la fin de colonne.
    const place = onColumn ? null : (hintOf(event) ?? hint);
    const where = place ? (place.before ? { before: overId } : { after: overId }) : { end: true as const };
    const order = boardOrder(allIds, columns, activeId, target.key, where);

    const sameOrder = order.length === allIds.length && order.every((id, index) => id === allIds[index]);
    if (sameOrder && target.key === (columnOf.get(activeId) ?? null)) return;
    await onMove(activeId, target.value, order);
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
              key={columnKey(column)}
              column={column}
              groupProp={groupProp}
              properties={properties}
              hint={hint}
              collapsed={collapsed.has(columnKey(column))}
              onCreate={onCreate}
              onToggle={() => toggleCollapsed(columnKey(column))}
              onHandleKey={(event) => onHandleKey(event, column)}
            />
          ))}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="board-card drag-overlay-card">
            {"card" in dragging ? <PageLabel row={dragging.card} /> : dragging.column.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Avant ou après la cible, selon le centre de l'élément tiré : vertical pour
// une carte devant une carte, horizontal pour une colonne devant une colonne.
// Une carte au-dessus d'une colonne n'a pas de trait (dépôt en fin).
function hintOf(event: DragOverEvent | DragEndEvent): Hint | null {
  const { active, over } = event;
  if (!over || over.id === active.id) return null;
  const id = String(over.id);
  const rect = active.rect.current.translated;
  if (isColumnDrag(active.id)) {
    if (!isColumnTarget(id) || id.slice(COLUMN_PREFIX.length) === String(active.id).slice(MOVE_PREFIX.length)) return null;
    return { id, before: rect ? rect.left + rect.width / 2 < over.rect.left + over.rect.width / 2 : true };
  }
  if (isColumnTarget(id)) return null;
  return { id, before: rect ? rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2 : true };
}

type ColumnProps = {
  column: Column;
  groupProp: Property;
  properties: Property[];
  hint: Hint | null;
  collapsed: boolean;
  onCreate: (values: Values) => void;
  onToggle: () => void;
  onHandleKey: (event: KeyboardEvent) => void;
};

function BoardColumn({ column, groupProp, properties, hint, collapsed, onCreate, onToggle, onHandleKey }: ColumnProps) {
  const key = columnKey(column);
  const drop = useDroppable({ id: COLUMN_PREFIX + key });
  const drag = useDraggable({ id: MOVE_PREFIX + key });
  const create = () => onCreate(column.value === null ? {} : { [groupProp.id]: column.value });

  const classes = ["board-column"];
  if (collapsed) classes.push("collapsed");
  // Le surlignage dit « la carte tombera ici » : sans objet pour une colonne tirée.
  if (drop.isOver && !isColumnDrag(drop.active?.id)) classes.push("over");
  if (hint?.id === COLUMN_PREFIX + key) classes.push(hint.before ? "drop-before" : "drop-after");
  if (drag.isDragging) classes.push("dragging");

  const label = column.color ? <OptionChip option={{ name: column.name, color: column.color }} /> : <span className="board-column-name">{column.name}</span>;
  const handle = (
    <button
      ref={(element) => drag.setNodeRef(element)}
      type="button"
      className="drag-handle"
      aria-label={`Déplacer la colonne « ${column.name} »`}
      {...drag.listeners}
      {...drag.attributes}
      onKeyDown={onHandleKey}
    >
      ⠿
    </button>
  );
  const fold = (
    <button
      type="button"
      className="ghost board-fold"
      aria-label={`${collapsed ? "Déplier" : "Replier"} la colonne « ${column.name} »`}
      aria-expanded={!collapsed}
      title={collapsed ? "Déplier" : "Replier"}
      onClick={onToggle}
    >
      {collapsed ? "▸" : "◂"}
    </button>
  );

  return (
    <section ref={(element) => drop.setNodeRef(element)} className={classes.join(" ")} aria-label={column.name}>
      <header className="board-column-head">
        {handle}
        {collapsed ? (
          fold
        ) : (
          <>
            {label}
            <span className="board-count">{column.entries.length}</span>
            {fold}
            <button type="button" className="ghost board-add" aria-label={`Nouvelle entrée dans « ${column.name} »`} onClick={create}>
              +
            </button>
          </>
        )}
      </header>
      {collapsed ? (
        <div className="board-column-vertical">
          {label}
          <span className="board-count">{column.entries.length}</span>
        </div>
      ) : (
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
      )}
    </section>
  );
}
