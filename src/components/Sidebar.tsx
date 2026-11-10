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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { announceEditorDrop, announceEditorHover, dropHostAt, pointOf, type DropPoint } from "./editor_drop";
import { announcePageMoved } from "./page_moved";

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

  // Sans parent : une page naît à la racine de l'arbre, une base sous celle des
  // bases ; une sous-page naît du menu « / » de sa mère. Le « + » de la racine
  // et de ses dossiers passe parentId.
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

  // Pointeur suivi pendant un glisser : l'éditeur de la page ouverte est hors
  // du contexte dnd-kit, la barre décide elle-même s'il est survolé
  // (editor_drop.ts). Seule une page se dépose dans un corps.
  const pointer = useRef<DropPoint | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);

  function trackPointer(row: TreeRow | null, start: Event) {
    stopTracking.current?.();
    pointer.current = pointOf(start);
    if (row?.type !== "page") return;
    const follow = (point: DropPoint | null) => {
      if (!point) return;
      pointer.current = point;
      const host = dropHostAt(point);
      announceEditorHover(host?.dataset.dropPage ? { hostId: host.dataset.dropPage, point } : null);
    };
    const onMouse = (event: MouseEvent) => follow(pointOf(event));
    const onTouch = (event: TouchEvent) => follow(pointOf(event));
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("touchmove", onTouch, { passive: true });
    stopTracking.current = () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      announceEditorHover(null);
      stopTracking.current = null;
    };
  }

  useEffect(() => () => stopTracking.current?.(), []);

  function endDrag() {
    setDragging(null);
    stopTracking.current?.();
  }

  function onDragStart(event: DragStartEvent) {
    const row = rows.find((candidate) => candidate.id === event.active.id) ?? null;
    setDragging(row);
    trackPointer(row, event.activatorEvent);
  }

  // Page lâchée sur l'éditeur de la page ouverte : elle y devient sous-page,
  // à l'endroit visé. Le serveur la reparente et retire son bloc de l'ancienne
  // mère sans en poser chez la nouvelle (placeBlock: false) ; l'éditeur pose
  // le bloc lui-même. Déjà enfant de cette page, seul son bloc se déplace.
  async function dropInBody(pageId: string, hostId: string, point: DropPoint) {
    const moved = rows.find((row) => row.id === pageId);
    if (!moved) return;
    if (moved.type !== "page") {
      setMessage("Seule une page se dépose dans le corps d'une page : rangez bases et dossiers dans l'arbre.");
      return;
    }
    if ((parentOf.get(pageId) ?? null) !== hostId && !(await relocate(pageId, hostId, undefined, { placeBlock: false }))) return;
    announceEditorDrop({ hostId, pageId, point });
  }

  // target : nouveau parent ; before absent, la page garde sa clé d'ordre
  // (dépôt sur une ligne), before null la met en fin de liste, sinon devant
  // cette sœur (zone d'insertion). Vrai si le serveur a déplacé la page.
  async function relocate(
    pageId: string,
    target: string | null,
    before?: string | null,
    { placeBlock = true }: { placeBlock?: boolean } = {},
  ): Promise<boolean> {
    const moved = rows.find((row) => row.id === pageId);
    // Refus immédiat de déplacer la racine des bases, sans attendre le serveur.
    if (moved?.basesRoot) {
      setMessage("« Bases de données » reste sous « Ressources ».");
      return false;
    }
    const parent = target ? rows.find((row) => row.id === target) : undefined;
    // Même règle que le serveur (lib/bases.ts) : une page n'entre pas dans un
    // dossier, une base ne vit que sous la racine ou un dossier. La ligne reste
    // à sa place.
    const refused = moved && placementError(
      { type: moved.type, isBasesRoot: moved.basesRoot, rootException: moved.rootException },
      parent ? { type: parent.type, isBasesRoot: parent.basesRoot, rootException: parent.rootException } : null,
    );
    if (refused) {
      setMessage(refused);
      return false;
    }
    // Refus immédiat, sans attendre le serveur (qui refuserait aussi).
    if (wouldCreateCycle(parentOf, pageId, target)) {
      setMessage("Une page ne peut pas aller sous elle-même ni sous l'une de ses sous-pages.");
      return false;
    }
    const body: Record<string, unknown> = before === undefined ? { parentId: target } : { parentId: target, before };
    if (!placeBlock) body.placeBlock = false;
    if (!(await post(`/api/pages/${pageId}/move`, body))) return false;
    if (target && !expanded.has(target)) setExpanded(new Set([...expanded, target]));
    // Le bloc de la page a quitté l'ancienne mère et rejoint la nouvelle :
    // l'éditeur ouvert sur l'une d'elles se relit.
    const from = parentOf.get(pageId) ?? null;
    if (target !== from) announcePageMoved({ pageId, from, to: target });
    router.refresh();
    return true;
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const point = pointer.current;
    endDrag();
    const pageId = String(active.id);
    // L'éditeur de la page ouverte prime : la vignette, encore proche de la
    // barre, peut toucher une ligne de l'arbre alors que le pointeur est dans
    // le corps.
    const host = point ? dropHostAt(point) : null;
    if (point && host?.dataset.dropPage) {
      await dropInBody(pageId, host.dataset.dropPage, point);
      return;
    }
    if (!over || over.id === active.id) return;
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
            onDragCancel={endDrag}
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
