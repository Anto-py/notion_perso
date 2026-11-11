"use client";
// Vue Tableau : une ligne par entrée, une colonne par propriété affichée (la
// vue peut en masquer), le titre en tête. Chaque cellule porte l'éditeur de son type : la valeur se règle là,
// sans ouvrir l'entrée ; un texte ou un lien s'ouvre dans un encadré qui le montre en entier. Cliquer ailleurs sur la ligne ouvre l'entrée. En pied
// de colonne, un calcul propre à la vue, sur les entrées qu'elle montre.
//
// Deux glissers distincts, filtrés par famille d'identifiant : une colonne se
// déplace par la poignée de son en-tête (elle réordonne le schéma, commun à
// toutes les vues), une ligne par la poignée de son titre (elle écrit l'ordre
// manuel, seulement quand la vue n'a pas de tri). La première colonne et la
// ligne d'en-tête peuvent être figées, réglage de la vue.
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useRef, useState, type KeyboardEvent } from "react";
import { TITLE_PROP, type EntryRow, type OrderPlace, type Property, type Sort, type Value } from "@/lib/properties";
import { CALC_LABELS, calcOpsFor, calcText, computeCalc, type CalcOp } from "@/lib/views";
import { fixedColumnWidths } from "@/lib/table_layout";
import { ColumnResizer } from "./ColumnResizer";
import { ExpandableCell } from "./ExpandableCell";
import { PageLabel } from "./PageIcon";
import { PropertyInput } from "./PropertyInput";
import { propIcon } from "./propertyUi";
import { SortButton, ariaSort, sortDir } from "./SortHeader";

type Props = {
  properties: Property[];
  entries: EntryRow[];
  filtered: boolean;
  // Tri de la vue, et le geste qui le fait avancer au clic sur un en-tête.
  sorts: Sort[];
  onCycleSort: (propId: string) => void;
  // Une vue triée n'a pas d'ordre manuel visible : la poignée des lignes
  // s'efface et une mention invite à retirer le tri.
  canReorderEntries: boolean;
  // Absent dans une vue liée (étape 16) : l'ordre des colonnes appartient à la
  // base, qui ne se modifie que sur son écran. Les en-têtes perdent leur poignée.
  onReorderProperty?: (propId: string, place: OrderPlace) => void;
  onMoveEntry: (entryId: string, place: OrderPlace) => void;
  frozenFirstColumn: boolean;
  frozenHeader: boolean;
  // Largeurs réglées à la main, propres à la vue, par propriété (« title »
  // pour le titre). Une colonne absente reprend son calcul automatique.
  columnWidths: Record<string, number>;
  onColumnWidth: (propId: string, width: number, delay?: number) => void;
  onCreate: () => void;
  onSave: (entryId: string, propId: string, value: Value | null) => void;
  onCreateOption: (prop: Property, name: string) => Promise<string | null>;
  onCreateEntry: (prop: Property, title: string) => Promise<string | null>;
  calcs: Record<string, CalcOp>;
  onCalc: (propId: string, op: CalcOp | null) => void;
};

// Un clic sur un élément de saisie ne doit pas ouvrir l'entrée.
const INTERACTIVE = "a, button, input, select, textarea, label, .picker";

// Les colonnes et les lignes vivent dans le même contexte de glisser ; leur
// préfixe empêche une colonne de se déposer sur une ligne, et inversement.
const COL = "col:";
const ROW = "row:";
const keyOf = (id: string) => (id.startsWith(COL) ? id.slice(COL.length) : id.slice(ROW.length));

type Hint = { id: string; before: boolean };

export function TableView({
  properties,
  entries,
  filtered,
  sorts,
  onCycleSort,
  canReorderEntries,
  onReorderProperty,
  onMoveEntry,
  frozenFirstColumn,
  frozenHeader,
  columnWidths,
  onColumnWidth,
  onCreate,
  onSave,
  onCreateOption,
  onCreateEntry,
  calcs,
  onCalc,
}: Props) {
  const router = useRouter();
  // Un cumul cassé est signalé sur chaque entrée par fillRollups : même
  // information partout, l'en-tête la reprend.
  const broken = entries[0]?.brokenRollups ?? [];
  const [dragging, setDragging] = useState<{ label: string; column: boolean } | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  // Largeur vivante pendant un glissement : elle s'affiche sans écrire, et
  // seule la valeur du relâchement part au serveur.
  const [preview, setPreview] = useState<{ propId: string; width: number } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const widthOf = (propId: string) => (preview?.propId === propId ? preview.width : columnWidths[propId]);
  // Le passage en table fixe dès la première largeur posée est ce qui rend la
  // valeur exacte : en largeur automatique, le contenu peut l'emporter.
  const fixed = preview !== null || Object.keys(columnWidths).length > 0;
  const layout = fixedColumnWidths(
    [TITLE_PROP.id, ...properties.map((prop) => prop.id)],
    preview ? { ...columnWidths, [preview.propId]: preview.width } : columnWidths,
  );

  function previewWidth(propId: string, width: number | null) {
    setPreview(width === null ? null : { propId, width });
  }

  // Largeur qui montre la colonne entière : on mesure le contenu réel en
  // disposant le tableau en max-content le temps d'une lecture, puis on
  // restaure les styles avant que React ne repeigne. scrollWidth ne convient
  // pas : il renvoie la largeur déjà contrainte de la cellule, pas celle du
  // contenu.
  function fitWidth(index: number): number | null {
    const table = tableRef.current;
    const col = table?.querySelectorAll("col")[index];
    if (!table || !col) return null;
    const style = table.style;
    const savedLayout = style.tableLayout;
    const savedWidth = style.width;
    const savedCol = col.style.width;
    const wasFixed = table.classList.contains("col-fixed");
    // La poignée dépasse de 4 px à droite de l'en-tête : masquée, elle ne
    // gonfle pas la mesure du contenu.
    const handle = table.rows[0]?.cells[index]?.querySelector<HTMLElement>(".col-resize");
    const savedDisplay = handle?.style.display;
    if (handle) handle.style.display = "none";
    table.classList.add("col-fixed");
    style.tableLayout = "auto";
    style.width = "max-content";
    col.style.width = "";
    const cell = table.rows[0]?.cells[index];
    // scrollWidth rattrape ce que le contenu de l'en-tête déborde (icône de
    // tri), que le rectangle de la cellule ne compte pas.
    const measured = cell ? Math.max(Math.ceil(cell.getBoundingClientRect().width), cell.scrollWidth) : 0;
    style.tableLayout = savedLayout;
    style.width = savedWidth;
    col.style.width = savedCol;
    if (handle) handle.style.display = savedDisplay ?? "";
    if (!wasFixed) table.classList.remove("col-fixed");
    return measured > 0 ? measured + 2 : null;
  }

  // Même motif que le Kanban : un léger déplacement à la souris, un appui
  // maintenu au doigt pour laisser défiler. MouseSensor, jamais PointerSensor.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Un glisser ne voit que les cibles de sa famille : la poignée d'une
  // colonne ne peut pas être déposée sur une ligne, et réciproquement.
  const collisionDetection: CollisionDetection = (args) => {
    const prefix = String(args.active.id).startsWith(COL) ? COL : ROW;
    const sameFamily = (id: unknown) => String(id).startsWith(prefix);
    const hits = pointerWithin(args).filter((hit) => sameFamily(hit.id));
    return hits.length > 0 ? hits : closestCenter(args).filter((hit) => sameFamily(hit.id));
  };

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith(COL)) {
      const prop = properties.find((item) => item.id === keyOf(id));
      if (prop) setDragging({ label: prop.name, column: true });
    } else {
      const entry = entries.find((item) => item.id === keyOf(id));
      if (entry) setDragging({ label: entry.title || "Sans titre", column: false });
    }
  }

  function onDragOver(event: DragOverEvent) {
    const next = hintOf(event);
    setHint((current) => (current?.id === next?.id && current?.before === next?.before ? current : next));
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    setHint(null);
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    const spot = hintOf(event);
    if (!spot) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const place: OrderPlace = spot.before ? { before: keyOf(overId) } : { after: keyOf(overId) };
    if (activeId.startsWith(COL) && overId.startsWith(COL)) onReorderProperty?.(keyOf(activeId), place);
    else if (activeId.startsWith(ROW) && overId.startsWith(ROW) && canReorderEntries) onMoveEntry(keyOf(activeId), place);
  }

  const wrapClass = ["table-wrap", frozenFirstColumn ? "frozen-col" : "", frozenHeader ? "frozen-head" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <DndContext
      // id explicite : identifiant d'accessibilité stable entre serveur et client.
      id="table-dnd"
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
      <div className="table-block">
        <div className={wrapClass}>
          <table
            ref={tableRef}
            className={fixed ? "db-table col-fixed" : "db-table"}
            style={fixed ? { width: `${layout.total}px` } : undefined}
          >
            <colgroup>
              <col style={fixed ? { width: `${layout.widths[0]}px` } : undefined} />
              {properties.map((prop, index) => (
                <col key={prop.id} style={fixed ? { width: `${layout.widths[index + 1]}px` } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort(sortDir(sorts, TITLE_PROP.id))}>
                  <SortButton label="Titre" icon="Aa" dir={sortDir(sorts, TITLE_PROP.id)} onCycle={() => onCycleSort(TITLE_PROP.id)} />
                  <ColumnResizer
                    label="Titre"
                    width={widthOf(TITLE_PROP.id)}
                    onResize={(value, delay) => onColumnWidth(TITLE_PROP.id, value, delay)}
                    onPreview={(value) => previewWidth(TITLE_PROP.id, value)}
                    onAutoFit={() => fitWidth(0)}
                  />
                </th>
                {properties.map((prop, index) => (
                  <ColumnHead
                    key={prop.id}
                    prop={prop}
                    index={index + 1}
                    width={widthOf(prop.id)}
                    broken={broken.includes(prop.id)}
                    dir={sortDir(sorts, prop.id)}
                    hint={hint}
                    movable={!!onReorderProperty}
                    onCycle={() => onCycleSort(prop.id)}
                    onColumnWidth={onColumnWidth}
                    onPreview={previewWidth}
                    onAutoFit={fitWidth}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <EntryLine
                  key={entry.id}
                  entry={entry}
                  properties={properties}
                  broken={broken}
                  canReorder={canReorderEntries}
                  hint={hint}
                  onMoveEntry={onMoveEntry}
                  onOpen={() => router.push(`/page/${entry.id}`)}
                  onSave={onSave}
                  onCreateOption={onCreateOption}
                  onCreateEntry={onCreateEntry}
                  previous={entries[index - 1]}
                  next={entries[index + 1]}
                />
              ))}
              {entries.length === 0 && filtered && (
                <tr>
                  <td colSpan={properties.length + 1} className="hint">
                    Aucune entrée ne correspond aux filtres.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                {[TITLE_PROP, ...properties].map((prop) => (
                  <td key={prop.id}>
                    <CalcCell prop={prop} op={calcs[prop.id]} entries={entries} onChange={(op) => onCalc(prop.id, op)} />
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="table-foot">
          <button type="button" className="ghost add-entry" onClick={onCreate}>
            + Nouvelle entrée
          </button>
          {!canReorderEntries && entries.length > 1 && (
            <span className="hint">La vue est triée : retirez le tri pour déplacer les lignes.</span>
          )}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <div className={dragging.column ? "table-drag drag-column" : "table-drag"}>{dragging.label}</div>}
      </DragOverlay>
    </DndContext>
  );
}

// En-tête d'une propriété : cible de dépôt pour une colonne, poignée de
// glisser pour la déplacer, et bouton de tri (la colonne Titre, fixe, n'a que
// le tri).
function ColumnHead({
  prop,
  index,
  width,
  broken,
  dir,
  hint,
  movable,
  onCycle,
  onColumnWidth,
  onPreview,
  onAutoFit,
}: {
  prop: Property;
  index: number;
  width: number | undefined;
  broken: boolean;
  dir: Sort["dir"] | null;
  hint: Hint | null;
  movable: boolean;
  onCycle: () => void;
  onColumnWidth: (propId: string, width: number, delay?: number) => void;
  onPreview: (propId: string, width: number | null) => void;
  onAutoFit: (index: number) => number | null;
}) {
  const drag = useDraggable({ id: COL + prop.id, disabled: !movable });
  const drop = useDroppable({ id: COL + prop.id, disabled: !movable });
  const side = hint?.id === COL + prop.id ? (hint.before ? "drop-before" : "drop-after") : null;
  return (
    <th ref={(element) => drop.setNodeRef(element)} scope="col" className={side ?? undefined} aria-sort={ariaSort(dir)}>
      {movable && (
        <button
          ref={(element) => drag.setNodeRef(element)}
          type="button"
          className="drag-handle"
          aria-label={`Déplacer la colonne ${prop.name}`}
          {...drag.listeners}
          {...drag.attributes}
        >
          ⠿
        </button>
      )}
      <SortButton label={prop.name} icon={propIcon(prop)} dir={dir} onCycle={onCycle} />
      {broken && (
        <span className="hint" title="La propriété visée a disparu ou changé de type : réparez le cumul dans les propriétés">
          {" "}
          ⚠
        </span>
      )}
      <ColumnResizer
        label={prop.name}
        width={width}
        onResize={(value, delay) => onColumnWidth(prop.id, value, delay)}
        onPreview={(value) => onPreview(prop.id, value)}
        onAutoFit={() => onAutoFit(index)}
      />
    </th>
  );
}

type LineProps = {
  entry: EntryRow;
  properties: Property[];
  broken: string[];
  canReorder: boolean;
  hint: Hint | null;
  onMoveEntry: (entryId: string, place: OrderPlace) => void;
  onOpen: () => void;
  onSave: (entryId: string, propId: string, value: Value | null) => void;
  onCreateOption: (prop: Property, name: string) => Promise<string | null>;
  onCreateEntry: (prop: Property, title: string) => Promise<string | null>;
  previous: EntryRow | undefined;
  next: EntryRow | undefined;
};

// Une ligne : cible de dépôt pour une autre ligne, poignée de glisser dans sa
// cellule de titre. Les flèches haut et bas sur la poignée déplacent la ligne
// au clavier, équivalent accessible du glisser.
function EntryLine({
  entry,
  properties,
  broken,
  canReorder,
  hint,
  onMoveEntry,
  onOpen,
  onSave,
  onCreateOption,
  onCreateEntry,
  previous,
  next,
}: LineProps) {
  const drag = useDraggable({ id: ROW + entry.id });
  const drop = useDroppable({ id: ROW + entry.id });
  const side = hint?.id === ROW + entry.id ? (hint.before ? "drop-before" : "drop-after") : null;

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!canReorder) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const neighbor = event.key === "ArrowUp" ? previous : next;
    if (!neighbor) return;
    onMoveEntry(entry.id, event.key === "ArrowUp" ? { before: neighbor.id } : { after: neighbor.id });
  }

  return (
    <tr
      ref={(element) => drop.setNodeRef(element)}
      className={side ?? undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
        onOpen();
      }}
    >
      <td className="cell-title">
        {canReorder && (
          <button
            ref={(element) => drag.setNodeRef(element)}
            type="button"
            className="drag-handle row-handle"
            aria-label={`Déplacer l’entrée ${entry.title || "sans titre"} (flèches haut et bas)`}
            {...drag.listeners}
            {...drag.attributes}
            onKeyDown={onHandleKey}
          >
            ⠿
          </button>
        )}
        <Link href={`/page/${entry.id}`}>
          <PageLabel row={entry} />
        </Link>
      </td>
      {properties.map((prop) => (
        <td key={prop.id} className="cell-edit">
          {prop.type === "text" || prop.type === "url" ? (
            <ExpandableCell prop={prop} value={entry.values[prop.id]} onSave={(value) => onSave(entry.id, prop.id, value)} />
          ) : prop.type === "rollup" && broken.includes(prop.id) ? (
            <span className="hint" title="Cible introuvable">
              —
            </span>
          ) : (
            <PropertyInput
              prop={prop}
              value={entry.values[prop.id]}
              onSave={(value) => onSave(entry.id, prop.id, value)}
              onCreate={(name) => onCreateOption(prop, name)}
              onCreateEntry={onCreateEntry}
              links={entry.links?.[prop.id]}
            />
          )}
        </td>
      ))}
    </tr>
  );
}

// Avant ou après la cible, selon le centre de l'élément tiré : horizontal
// pour une colonne, vertical pour une ligne.
function hintOf(event: DragOverEvent | DragEndEvent): Hint | null {
  const { active, over } = event;
  if (!over || over.id === active.id) return null;
  const id = String(over.id);
  const rect = active.rect.current.translated;
  if (!rect) return { id, before: true };
  const column = String(active.id).startsWith(COL);
  const before = column
    ? rect.left + rect.width / 2 < over.rect.left + over.rect.width / 2
    : rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2;
  return { id, before };
}

// Le résultat s'affiche ; le <select> natif, transparent par-dessus, ouvre la
// liste des calculs (roue du système sur téléphone).
function CalcCell({ prop, op, entries, onChange }: { prop: Property; op: CalcOp | undefined; entries: EntryRow[]; onChange: (op: CalcOp | null) => void }) {
  return (
    <label className={op ? "calc-cell calc-set" : "calc-cell"}>
      <span aria-hidden="true">{op ? calcText(prop, op, computeCalc(entries, prop, op)) : "Calculer"}</span>
      <select aria-label={`Calcul de ${prop.name}`} value={op ?? ""} onChange={(event) => onChange((event.target.value || null) as CalcOp | null)}>
        <option value="">Aucun</option>
        {calcOpsFor(prop).map((item) => (
          <option key={item} value={item}>
            {CALC_LABELS[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
