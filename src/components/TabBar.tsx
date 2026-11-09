"use client";
// Barre des onglets ouverts, en haut de la zone de contenu. Chaque onglet est
// un lien et une cible de glisser : on le déplace pour changer l'ordre, la
// croix le ferme. Le « + » ouvre l'Accueil dans un nouvel onglet.
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { appPathname, dropIndex, type Tab } from "@/lib/tabs";
import { PageIcon } from "./PageIcon";
import {
  getServerSnapshot as sidebarServerSnapshot,
  getSnapshot as sidebarSnapshot,
  subscribe as sidebarSubscribe,
  toggleSidebar,
} from "./sidebar_store";
import { close, getServerSnapshot, getSnapshot, open, reorder, subscribe } from "./tabs_store";

type Drop = { href: string; after: boolean } | null;

// Position horizontale du pointeur au moment du dépôt, pour choisir le côté.
function pointerX(event: DragMoveEvent | DragEndEvent): number {
  const initial = event.activatorEvent as MouseEvent | TouchEvent;
  const base = "touches" in initial ? (initial.touches[0]?.clientX ?? 0) : initial.clientX;
  return base + event.delta.x;
}

export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const sidebar = useSyncExternalStore(sidebarSubscribe, sidebarSnapshot, sidebarServerSnapshot);
  const [dragging, setDragging] = useState<Tab | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const current = appPathname(pathname);

  function shut(href: string) {
    const destination = close(href);
    if (destination) router.push(destination);
  }

  function onDragStart(event: DragStartEvent) {
    setDragging(state.tabs.find((tab) => tab.href === event.active.id) ?? null);
  }

  function onDragMove(event: DragMoveEvent) {
    if (!event.over || event.over.id === event.active.id) {
      setDrop(null);
      return;
    }
    const rect = event.over.rect;
    const after = pointerX(event) > rect.left + rect.width / 2;
    const href = String(event.over.id);
    setDrop((previous) => (previous && previous.href === href && previous.after === after ? previous : { href, after }));
  }

  function onDragEnd(event: DragEndEvent) {
    // Le côté se relit dans l'événement : l'état « drop » peut ne pas avoir été
    // rendu entre le dernier déplacement et le lâcher.
    if (event.over && event.over.id !== event.active.id) {
      const rect = event.over.rect;
      const after = pointerX(event) > rect.left + rect.width / 2;
      const from = state.tabs.findIndex((tab) => tab.href === event.active.id);
      const over = state.tabs.findIndex((tab) => tab.href === event.over?.id);
      if (from !== -1 && over !== -1) reorder(from, dropIndex(from, over, after));
    }
    setDragging(null);
    setDrop(null);
  }

  return (
    <DndContext
      id="tabs-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setDrop(null);
      }}
    >
      <nav className="tabs" aria-label="Onglets ouverts">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebar.hidden ? "Afficher la barre latérale" : "Masquer la barre latérale"}
          aria-expanded={!sidebar.hidden}
          aria-controls="barre-laterale"
          title={sidebar.hidden ? "Afficher la barre latérale" : "Masquer la barre latérale"}
          onClick={toggleSidebar}
        >
          ☰
        </button>
        {state.ready &&
          state.tabs.map((tab) => (
            <TabItem key={tab.href} tab={tab} active={tab.href === current} drop={drop} onClose={() => shut(tab.href)} />
          ))}
        {state.ready && (
          <button
            type="button"
            className="tab-new"
            aria-label="Nouvel onglet"
            title="Nouvel onglet"
            onClick={() => {
              open("/", true);
              router.push("/");
            }}
          >
            +
          </button>
        )}
      </nav>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="tab tab-overlay active">
            <span className="tab-link">
              <PageIcon icon={dragging.icon} type={dragging.type} />
              <span className="tab-title">{dragging.title || "Sans titre"}</span>
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function TabItem({ tab, active, drop, onClose }: { tab: Tab; active: boolean; drop: Drop; onClose: () => void }) {
  const drag = useDraggable({ id: tab.href });
  const target = useDroppable({ id: tab.href });
  const classes = ["tab"];
  if (active) classes.push("active");
  if (drag.isDragging) classes.push("dragging");
  if (drop?.href === tab.href) classes.push(drop.after ? "drop-after" : "drop-before");
  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        target.setNodeRef(element);
      }}
      className={classes.join(" ")}
      {...drag.listeners}
    >
      <Link
        href={tab.href}
        prefetch={false}
        className="tab-link"
        aria-current={active ? "page" : undefined}
        title={tab.title || "Sans titre"}
        onClick={(event) => {
          // Un Cmd+clic sur la barre n'a rien de plus à faire : l'onglet est
          // déjà là. Sans cela, Next laisserait le navigateur ouvrir une
          // seconde fenêtre sur la même application.
          if (event.metaKey || event.ctrlKey) event.preventDefault();
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <PageIcon icon={tab.icon} type={tab.type} />
        <span className="tab-title">{tab.title || "Sans titre"}</span>
      </Link>
      <button
        type="button"
        className="tab-close"
        aria-label={`Fermer ${tab.title || "l'onglet"}`}
        title="Fermer l'onglet"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
