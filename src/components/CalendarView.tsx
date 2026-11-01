"use client";
// Vue Calendrier (BRAINSTORMING §4) : un mois ou une semaine, une case par
// jour, les entrées posées sur la date choisie de la vue. Glisser une entrée
// vers un autre jour écrit cette date ; le « + » d'une case crée une entrée
// datée ; les entrées sans date sont listées à part, jamais perdues.
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useState } from "react";
import {
  addDays,
  addMonths,
  entriesByDay,
  monthDays,
  todayInBrussels,
  undatedEntries,
  weekDays,
  type CalendarScale,
} from "@/lib/calendar";
import type { EntryRow, Property, Values } from "@/lib/properties";
import { PageLabel } from "./PageIcon";

const DAY_PREFIX = "day:";
const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

// Seules les cases du jour sont des cibles : le pointeur les traverse, une
// entrée posée dessus n'intercepte pas le dépôt.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const day = hits.find((hit) => String(hit.id).startsWith(DAY_PREFIX));
  return day ? [day] : hits;
};

// Jour civil → midi UTC pour l'affichage : le libellé ne dépend d'aucun
// fuseau, la date est déjà celle de Bruxelles.
function dateOf(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

const monthFormat = new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "short", timeZone: "UTC" });
const yearFormat = new Intl.DateTimeFormat("fr-BE", { year: "numeric", timeZone: "UTC" });
const fullDayFormat = new Intl.DateTimeFormat("fr-BE", { dateStyle: "full", timeZone: "UTC" });

function periodLabel(anchor: string, scale: CalendarScale): string {
  if (scale === "month") {
    const label = monthFormat.format(dateOf(anchor));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const days = weekDays(anchor);
  return `Du ${dayFormat.format(dateOf(days[0]))} au ${dayFormat.format(dateOf(days[6]))} ${yearFormat.format(dateOf(days[6]))}`;
}

type Props = {
  dateProp: Property;
  scale: CalendarScale;
  entries: EntryRow[];
  onCreate: (values: Values) => void;
  onMove: (entryId: string, day: string) => void;
};

export function CalendarView({ dateProp, scale, entries, onCreate, onMove }: Props) {
  const [anchor, setAnchor] = useState(() => todayInBrussels());
  const [dragging, setDragging] = useState<EntryRow | null>(null);
  const today = todayInBrussels();
  const days = scale === "month" ? monthDays(anchor) : weekDays(anchor);
  const monthKey = anchor.slice(0, 7);
  const byDay = entriesByDay(entries, dateProp.id);
  const undated = undatedEntries(entries, dateProp.id);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function shift(delta: number) {
    setAnchor((current) => (scale === "month" ? addMonths(current, delta) : addDays(current, delta * 7)));
  }

  function onDragStart(event: DragStartEvent) {
    setDragging(entries.find((entry) => entry.id === String(event.active.id)) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const target = String(over.id);
    if (!target.startsWith(DAY_PREFIX)) return;
    const day = target.slice(DAY_PREFIX.length);
    const entry = entries.find((item) => item.id === String(active.id));
    if (!entry || entry.values[dateProp.id] === day) return;
    onMove(entry.id, day);
  }

  return (
    <DndContext
      id="calendar-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="calendar">
        <div className="calendar-bar">
          <button type="button" className="ghost calendar-nav" aria-label="Période précédente" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="calendar-title" aria-live="polite">
            {periodLabel(anchor, scale)}
          </span>
          <button type="button" className="ghost calendar-nav" aria-label="Période suivante" onClick={() => shift(1)}>
            ›
          </button>
          <button type="button" className="ghost" onClick={() => setAnchor(today)}>
            Aujourd&apos;hui
          </button>
        </div>

        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>

        <div className={`calendar-grid calendar-${scale}`}>
          {days.map((day) => (
            <DayCell
              key={day}
              day={day}
              outside={scale === "month" && day.slice(0, 7) !== monthKey}
              isToday={day === today}
              entries={byDay.get(day) ?? []}
              dateProp={dateProp}
              onCreate={onCreate}
            />
          ))}
        </div>

        {undated.length > 0 && (
          <section className="calendar-undated" aria-label="Entrées sans date">
            <h3>Sans date</h3>
            <ul>
              {undated.map((entry) => (
                <li key={entry.id}>
                  <Chip entry={entry} />
                </li>
              ))}
            </ul>
            <p className="hint">Glissez une entrée sur un jour pour lui donner sa date.</p>
          </section>
        )}

        {entries.length === 0 && <p className="hint">Aucune entrée ne correspond aux filtres.</p>}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <span className="calendar-chip drag-overlay-chip">
            <PageLabel row={dragging} />
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

type CellProps = {
  day: string;
  outside: boolean;
  isToday: boolean;
  entries: EntryRow[];
  dateProp: Property;
  onCreate: (values: Values) => void;
};

function DayCell({ day, outside, isToday, entries, dateProp, onCreate }: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_PREFIX}${day}` });
  const classes = ["calendar-cell"];
  if (outside) classes.push("outside");
  if (isToday) classes.push("today");
  if (isOver) classes.push("over");
  const label = fullDayFormat.format(dateOf(day));

  return (
    <div ref={setNodeRef} className={classes.join(" ")} data-day={day}>
      <div className="calendar-dayhead">
        <span className="calendar-daynum">{Number(day.slice(8, 10))}</span>
        <button
          type="button"
          className="ghost calendar-add"
          aria-label={`Nouvelle entrée le ${label}`}
          onClick={() => onCreate({ [dateProp.id]: day })}
        >
          +
        </button>
      </div>
      <ul className="calendar-chips">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Chip entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ entry }: { entry: EntryRow }) {
  const drag = useDraggable({ id: entry.id });
  return (
    <span
      ref={(element) => {
        drag.setNodeRef(element);
      }}
      className={drag.isDragging ? "calendar-chip dragging" : "calendar-chip"}
      {...drag.attributes}
      {...drag.listeners}
    >
      <Link href={`/page/${entry.id}`} draggable={false}>
        <PageLabel row={entry} />
      </Link>
    </span>
  );
}
