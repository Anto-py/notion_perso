"use client";
// Sidebar : arbre des pages, création, reparentage par glisser-déposer,
// accès à la corbeille. Les données viennent du serveur (layout) ; après
// chaque modification, router.refresh() les relit.
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { placementError } from "@/lib/bases";
import { ancestorsOf, buildTree, GAP_PREFIX, parseGapId, wouldCreateCycle, type TreeRow } from "@/lib/tree";
import { AUTHOR_NAME, CV_URL } from "@/lib/branding";
import { formatClock } from "@/lib/sync_status";
import { PageLabel } from "./PageIcon";
import { SearchBar } from "./SearchBar";
import { SidebarResizer } from "./SidebarResizer";
import { hydrateSidebar } from "./sidebar_store";
import { SyncStatus } from "./SyncStatus";
import { setTreeMeta } from "./tabs_store";
import { TreeGap, TreeItem } from "./TreeItem";

export const ROOT_DROP_ID = "__racine__";

// Le pointeur choisit d'abord une zone d'insertion quand il est dedans ; sinon
// la ligne survolée décide, comme avant.
const collisionDetection: CollisionDetection = (args) => {
  const gaps = args.droppableContainers.filter((container) => String(container.id).startsWith(GAP_PREFIX));
  const inGap = pointerWithin({ ...args, droppableContainers: gaps });
  return inGap.length > 0 ? inGap : rectIntersection(args);
};

type Props = {
  rows: TreeRow[];
  username: string;
  inboxCount: number;
  // Dernier passage connu d'un Mac, lu sur l'app web ; null sur le Mac.
  macSyncedAt: string | null;
};

export function Sidebar({ rows, username, inboxCount, macSyncedAt }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  // Le pathname diffère entre le HTML prérendu et le navigateur : le lire après
  // le montage évite un écart d'hydratation, que React ne rattrape pas.
  const [shownPathname, setShownPathname] = useState<string | null>(null);
  useEffect(() => {
    // Après le montage : le premier rendu reste identique au HTML du serveur.
    const timer = setTimeout(() => setShownPathname(pathname), 0);
    return () => clearTimeout(timer);
  }, [pathname]);
  const activeId =
    shownPathname && /^\/(page|db)\//.test(shownPathname) ? decodeURIComponent(shownPathname.split("/")[2]) : null;

  const tree = useMemo(() => buildTree(rows), [rows]);
  const parentOf = useMemo(() => new Map(rows.map((row) => [row.id, row.parentId])), [rows]);

  // Titres et icônes des onglets : l'arbre les fournit, y compris aux onglets
  // inactifs. Une entrée de base, absente de l'arbre, les publie elle-même.
  useEffect(() => setTreeMeta(rows), [rows]);

  // Reprise du réglage d'appareil ; le script posé avant peinture a déjà
  // appliqué la largeur et le masquage au document.
  useEffect(() => {
    hydrateSidebar();
  }, []);

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

  // Sans parent : une page naît à la racine de l'arbre, une base à celle de
  // « Bases » ; une sous-page naît du menu « / » de sa mère. Le « + » de
  // « Bases » et de ses dossiers passe parentId.
  async function createPage(type: "page" | "database" | "folder" = "page", parentId: string | null = null) {
    const data = await post("/api/pages", { parentId, type });
    if (!data?.id) return;
    if (parentId && !expanded.has(parentId)) setExpanded(new Set([...expanded, parentId]));
    router.refresh();
    router.push(type === "database" ? `/db/${data.id}` : `/page/${data.id}`);
  }

  // Un léger déplacement avant de saisir : un simple clic reste un clic. Au
  // doigt, un appui maintenu, pour que le défilement de l'arbre reste possible.
  // MouseSensor et non PointerSensor, qui captait aussi le doigt (voir
  // KanbanView.tsx).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(rows.find((row) => row.id === event.active.id) ?? null);
  }

  // target : nouveau parent ; before absent, la page garde sa clé d'ordre
  // (dépôt sur une ligne), before null la met en fin de liste, sinon devant
  // cette sœur (zone d'insertion).
  async function relocate(pageId: string, target: string | null, before?: string | null) {
    const moved = rows.find((row) => row.id === pageId);
    const parent = target ? rows.find((row) => row.id === target) : undefined;
    // Même règle que le serveur (lib/bases.ts) : une page n'entre pas dans
    // « Bases », une base n'en sort pas. La ligne reste à sa place.
    const refused = moved && placementError({ type: moved.type, isBasesRoot: moved.basesRoot }, parent ? { type: parent.type, isBasesRoot: parent.basesRoot } : null);
    if (refused) {
      setMessage(refused);
      return;
    }
    // Refus immédiat, sans attendre le serveur (qui refuserait aussi).
    if (wouldCreateCycle(parentOf, pageId, target)) {
      setMessage("Une page ne peut pas aller sous elle-même ni sous l'une de ses sous-pages.");
      return;
    }
    const body = before === undefined ? { parentId: target } : { parentId: target, before };
    if (await post(`/api/pages/${pageId}/move`, body)) {
      if (target && !expanded.has(target)) setExpanded(new Set([...expanded, target]));
      router.refresh();
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over || over.id === active.id) return;
    const pageId = String(active.id);
    const gap = parseGapId(String(over.id));
    if (gap) {
      // Déposer une page devant elle-même ne fait rien.
      if (gap.beforeId === pageId) return;
      await relocate(pageId, gap.parentId, gap.beforeId);
      return;
    }
    const target = over.id === ROOT_DROP_ID ? null : String(over.id);
    if (target === (parentOf.get(pageId) ?? null)) return;
    await relocate(pageId, target);
  }

  return (
    <>
      <button type="button" className="menu-toggle" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
        {mobileOpen ? "Fermer" : "Menu"}
      </button>
      <aside id="barre-laterale" className={mobileOpen ? "sidebar open" : "sidebar"}>
        <a href={CV_URL} className="sidebar-home" target="_blank" rel="noopener noreferrer">
          {AUTHOR_NAME}
        </a>
        <SearchBar>
          <div className="new-buttons">
            <button type="button" className="new-page" onClick={() => createPage()}>
              + Nouvelle page
            </button>
            <button type="button" className="new-page" onClick={() => createPage("database")}>
              + Nouvelle base
            </button>
          </div>
          <Link href="/inbox" className={shownPathname === "/inbox" ? "inbox-link active" : "inbox-link"}>
            <span>Vide-cerveau</span>
            {inboxCount > 0 && (
              <span className="inbox-count" aria-label={`${inboxCount} à traiter`}>
                {inboxCount}
              </span>
            )}
          </Link>
          {message && (
            <p className="sidebar-message" role="alert">
              {message}
            </p>
          )}
          {/* id explicite : l'identifiant d'accessibilité de dnd-kit est sinon
              tiré d'un compteur global, différent au rendu serveur et au rendu
              client, d'où un avertissement d'hydratation. */}
          <DndContext
            id="tree-dnd"
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <nav className={dragging ? "tree dragging" : "tree"} aria-label="Pages">
              {tree.length === 0 ? (
                <p className="tree-empty">Aucune page.</p>
              ) : (
                <ul role="tree">
                  {tree.map((node) => (
                    <Fragment key={node.id}>
                      <TreeGap parentId={null} beforeId={node.id} depth={0} />
                      <TreeItem
                        node={node}
                        depth={0}
                        activeId={activeId}
                        expanded={expanded}
                        onToggle={toggle}
                        onCreate={(type, parentId) => void createPage(type, parentId)}
                      />
                    </Fragment>
                  ))}
                  <TreeGap parentId={null} beforeId={null} depth={0} />
                </ul>
              )}
              {dragging?.type === "page" && <RootDropZone />}
            </nav>
            <DragOverlay dropAnimation={null}>
              {dragging && <div className="drag-overlay"><PageLabel row={dragging} /></div>}
            </DragOverlay>
          </DndContext>
        </SearchBar>
        <div className="sidebar-footer">
          <Link href="/import" className={shownPathname === "/import" ? "active" : undefined}>
            Importer
          </Link>
          <Link href="/trash" className={shownPathname === "/trash" ? "active" : undefined}>
            Corbeille
          </Link>
          <Link href="/reglages" className={shownPathname === "/reglages" ? "active" : undefined}>
            Réglages
          </Link>
          <form method="post" action="/api/auth/logout">
            <span>{username}</span>{" "}
            <button type="submit" className="link">
              Se déconnecter
            </button>
          </form>
          {macSyncedAt && <p className="sync-mac">Mac synchronisé à {formatClock(new Date(macSyncedAt))}</p>}
          <SyncStatus />
        </div>
        <SidebarResizer />
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
