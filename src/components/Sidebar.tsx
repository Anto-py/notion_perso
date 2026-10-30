"use client";
// Sidebar : arbre des pages, création, reparentage par glisser-déposer,
// accès à la corbeille. Les données viennent du serveur (layout) ; après
// chaque modification, router.refresh() les relit.
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ancestorsOf, buildTree, label, wouldCreateCycle, type TreeRow } from "@/lib/tree";
import { TreeItem } from "./TreeItem";

export const ROOT_DROP_ID = "__racine__";

type Props = { rows: TreeRow[]; username: string };

export function Sidebar({ rows, username }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = /^\/(page|db)\//.test(pathname) ? decodeURIComponent(pathname.split("/")[2]) : null;

  const tree = useMemo(() => buildTree(rows), [rows]);
  const parentOf = useMemo(() => new Map(rows.map((row) => [row.id, row.parentId])), [rows]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<TreeRow | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ouvrir une page déplie ses ancêtres. Ajusté pendant le rendu (et non dans
  // un effet) : React recommande ce motif pour un état dérivé d'une prop.
  if (activeId !== shownFor) {
    setShownFor(activeId);
    setMobileOpen(false);
    if (activeId) {
      const ancestors = ancestorsOf(parentOf, activeId);
      if (ancestors.some((id) => !expanded.has(id))) setExpanded(new Set([...expanded, ...ancestors]));
    }
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  }

  async function post(url: string, body: unknown): Promise<{ id?: string } | null> {
    setMessage(null);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!response?.ok) {
      setMessage(data?.error ?? "Connexion perdue : action non effectuée.");
      return null;
    }
    return data ?? {};
  }

  async function createPage(parentId: string | null, type: "page" | "database" = "page") {
    const data = await post("/api/pages", { parentId, type });
    if (!data?.id) return;
    if (parentId && !expanded.has(parentId)) setExpanded(new Set([...expanded, parentId]));
    router.refresh();
    router.push(type === "database" ? `/db/${data.id}` : `/page/${data.id}`);
  }

  // Un léger déplacement avant de saisir : un simple clic reste un clic. Au
  // doigt, un appui maintenu, pour que le défilement de l'arbre reste possible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(rows.find((row) => row.id === event.active.id) ?? null);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over || over.id === active.id) return;
    const pageId = String(active.id);
    const target = over.id === ROOT_DROP_ID ? null : String(over.id);
    if (target === (parentOf.get(pageId) ?? null)) return;
    if (target && rows.find((row) => row.id === target)?.type !== "page") {
      setMessage("Seule une page peut recevoir des sous-pages.");
      return;
    }
    // Refus immédiat, sans attendre le serveur (qui refuserait aussi).
    if (wouldCreateCycle(parentOf, pageId, target)) {
      setMessage("Une page ne peut pas aller sous elle-même ni sous l'une de ses sous-pages.");
      return;
    }
    if (await post(`/api/pages/${pageId}/move`, { parentId: target })) {
      if (target && !expanded.has(target)) setExpanded(new Set([...expanded, target]));
      router.refresh();
    }
  }

  return (
    <>
      <button type="button" className="menu-toggle" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
        {mobileOpen ? "Fermer" : "Menu"}
      </button>
      <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
        <Link href="/" className="sidebar-home">
          notion_perso
        </Link>
        <div className="new-buttons">
          <button type="button" className="new-page" onClick={() => createPage(null)}>
            + Nouvelle page
          </button>
          <button type="button" className="new-page" onClick={() => createPage(null, "database")}>
            + Nouvelle base
          </button>
        </div>
        {message && (
          <p className="sidebar-message" role="alert">
            {message}
          </p>
        )}
        {/* id explicite : l'identifiant d'accessibilité de dnd-kit est sinon
            tiré d'un compteur global, différent au rendu serveur et au rendu
            client, d'où un avertissement d'hydratation. */}
        <DndContext id="tree-dnd" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <nav className="tree" aria-label="Pages">
            {tree.length === 0 ? (
              <p className="tree-empty">Aucune page.</p>
            ) : (
              <ul role="tree">
                {tree.map((node) => (
                  <TreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    activeId={activeId}
                    expanded={expanded}
                    onToggle={toggle}
                    onCreateChild={createPage}
                  />
                ))}
              </ul>
            )}
            {dragging && <RootDropZone />}
          </nav>
          <DragOverlay dropAnimation={null}>
            {dragging && <div className="drag-overlay">{label(dragging)}</div>}
          </DragOverlay>
        </DndContext>
        <div className="sidebar-footer">
          <Link href="/trash" className={pathname === "/trash" ? "active" : undefined}>
            Corbeille
          </Link>
          <form method="post" action="/api/auth/logout">
            <span>{username}</span>{" "}
            <button type="submit" className="link">
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div ref={setNodeRef} className={isOver ? "root-drop over" : "root-drop"}>
      Déposer ici pour remonter à la racine
    </div>
  );
}
