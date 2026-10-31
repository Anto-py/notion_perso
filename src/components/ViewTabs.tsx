"use client";
// Onglets des vues d'une base : choisir, créer (Tableau, Kanban, Liste),
// renommer, dupliquer, changer de type, supprimer, réordonner au glisser ou
// par le menu (clavier). Chaque geste remonte la liste complète des vues ;
// DatabaseView l'enregistre. La dernière vue ne se supprime pas.
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useRef, useState } from "react";
import { moveInOrder, type Property } from "@/lib/properties";
import { duplicateView, newView, sanitizeView, VIEW_KINDS, VIEW_LABELS, VIEW_LIMITS, type View, type ViewKind } from "@/lib/views";
import { CommitInput } from "./CommitInput";

export const VIEW_ICONS: Record<ViewKind, string> = { table: "▦", board: "▥", list: "☰" };

type Props = {
  views: View[];
  activeId: string;
  properties: Property[];
  onSelect: (id: string) => void;
  onChange: (views: View[], activeId?: string) => void;
};

export function ViewTabs({ views, activeId, properties, onSelect, onChange }: Props) {
  const [menu, setMenu] = useState<"view" | "new" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = views.find((view) => view.id === activeId) ?? views[0];
  const index = views.indexOf(active);

  // Mêmes capteurs que le Kanban : la souris part à 6 px, le doigt après un
  // appui de 250 ms, pour laisser défiler la rangée d'onglets.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) {
        setMenu(null);
        setRenaming(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  function replace(next: View) {
    onChange(views.map((view) => (view.id === next.id ? next : view)));
  }

  function reorder(movedId: string, place: { before: string } | { after: string }) {
    const ids = moveInOrder(
      views.map((view) => view.id),
      movedId,
      place,
    );
    onChange(ids.map((id) => views.find((view) => view.id === id)!));
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    if (!over || dragged.id === over.id) return;
    const from = views.findIndex((view) => view.id === dragged.id);
    const to = views.findIndex((view) => view.id === over.id);
    reorder(String(dragged.id), from < to ? { after: String(over.id) } : { before: String(over.id) });
  }

  function create(kind: ViewKind) {
    const view = newView(views, kind, properties);
    setMenu(null);
    onChange([...views, view], view.id);
  }

  return (
    <div className="view-tabs" ref={ref}>
      <DndContext id="view-tabs" sensors={sensors} onDragEnd={onDragEnd}>
        <div className="view-tab-row" role="tablist" aria-label="Vues de la base">
          {views.map((view) => (
            <Tab
              key={view.id}
              view={view}
              selected={view.id === active.id}
              onSelect={() => {
                setMenu(null);
                onSelect(view.id);
              }}
              onMenu={() => {
                setRenaming(false);
                setMenu(menu === "view" ? null : "view");
              }}
            />
          ))}
          {views.length < VIEW_LIMITS.views && (
            <button type="button" className="ghost view-tab-add" aria-label="Nouvelle vue" aria-expanded={menu === "new"} onClick={() => setMenu(menu === "new" ? null : "new")}>
              +
            </button>
          )}
        </div>
      </DndContext>

      {menu === "new" && (
        <div className="view-menu" role="menu" aria-label="Type de la nouvelle vue">
          {VIEW_KINDS.map((kind) => (
            <button key={kind} type="button" role="menuitem" className="ghost" onClick={() => create(kind)}>
              <span aria-hidden="true">{VIEW_ICONS[kind]}</span> {VIEW_LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {menu === "view" && (
        <div className="view-menu" role="menu" aria-label={`Vue ${active.name}`}>
          {renaming ? (
            <CommitInput
              autoFocus
              aria-label="Nom de la vue"
              value={active.name}
              maxLength={VIEW_LIMITS.name}
              allowEmpty={false}
              onCommit={(name) => {
                replace({ ...active, name });
                setRenaming(false);
                setMenu(null);
              }}
            />
          ) : (
            <button type="button" role="menuitem" className="ghost" onClick={() => setRenaming(true)}>
              Renommer
            </button>
          )}
          <label className="view-menu-kind">
            Type
            <select
              value={active.kind}
              onChange={(event) => replace(sanitizeView({ ...active, kind: event.target.value as ViewKind }, properties, active.id))}
            >
              {VIEW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {VIEW_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          {views.length < VIEW_LIMITS.views && (
            <button
              type="button"
              role="menuitem"
              className="ghost"
              onClick={() => {
                const copy = duplicateView(views, active);
                setMenu(null);
                onChange([...views.slice(0, index + 1), copy, ...views.slice(index + 1)], copy.id);
              }}
            >
              Dupliquer
            </button>
          )}
          {index > 0 && (
            <button type="button" role="menuitem" className="ghost" onClick={() => reorder(active.id, { before: views[index - 1].id })}>
              Déplacer à gauche
            </button>
          )}
          {index < views.length - 1 && (
            <button type="button" role="menuitem" className="ghost" onClick={() => reorder(active.id, { after: views[index + 1].id })}>
              Déplacer à droite
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="ghost danger-text"
            disabled={views.length === 1}
            title={views.length === 1 ? "La dernière vue d'une base ne se supprime pas" : undefined}
            onClick={() => {
              const rest = views.filter((view) => view.id !== active.id);
              setMenu(null);
              onChange(rest, rest[Math.max(0, index - 1)].id);
            }}
          >
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

function Tab({ view, selected, onSelect, onMenu }: { view: View; selected: boolean; onSelect: () => void; onMenu: () => void }) {
  const drag = useDraggable({ id: view.id });
  const drop = useDroppable({ id: view.id });
  const classes = ["view-tab"];
  if (selected) classes.push("selected");
  if (drag.isDragging) classes.push("dragging");
  if (drop.isOver && !drag.isDragging) classes.push("drop-target");
  return (
    <span
      className={classes.join(" ")}
      ref={(element) => {
        drag.setNodeRef(element);
        drop.setNodeRef(element);
      }}
    >
      <button type="button" {...drag.attributes} {...drag.listeners} role="tab" aria-selected={selected} onClick={onSelect}>
        <span className="view-tab-icon" aria-hidden="true">
          {VIEW_ICONS[view.kind]}
        </span>
        {view.name}
      </button>
      {selected && (
        <button type="button" className="ghost view-tab-more" aria-label={`Options de la vue ${view.name}`} onClick={onMenu}>
          ⋯
        </button>
      )}
    </span>
  );
}
