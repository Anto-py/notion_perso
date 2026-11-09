"use client";
// Bloc « linked » : une base existante montrée dans une page, avec des vues
// propres au bloc. Les onglets, filtres, tris, colonnes et calculs vivent dans
// la propriété `config` du bloc (texte JSON, lib/views.ts parseLinkedConfig) ;
// les entrées et le schéma restent ceux de la base source, où les saisies
// s'écrivent. BRAINSTORMING §4, SPECS « views ». Depuis l'étape 16, la
// structure de la base (colonnes, ordre, titre, icône) ne se modifie que sur
// son écran, dans « Bases » : le bloc saisit des entrées et règle ses vues.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  cycleSort,
  groupEntries,
  isGroupableType,
  matchesFilters,
  moveInOrder,
  sortEntries,
  withNewOption,
  withTimes,
  type EntryRow,
  type OrderPlace,
  type Property,
  type Value,
  type Values,
} from "@/lib/properties";
import {
  legacyLinkedViews,
  linkedConfigText,
  linkedViews,
  missingLegacyViews,
  parseLinkedConfig,
  pickView,
  prefillValues,
  viewOverride,
  withBoardColumns,
  withColumnWidth,
  withLinkedOverride,
  withoutLinkedOverride,
  type CalcOp,
  type DbConfig,
  type LinkedConfig,
  type View,
} from "@/lib/views";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { KanbanView } from "./KanbanView";
import { ListView } from "./ListView";
import { PageLabel } from "./PageIcon";
import { send } from "./request";
import { usePageDirectory } from "./subpageBlock";
import { TableView } from "./TableView";
import { ViewControls } from "./ViewControls";
import { ViewTabs } from "./ViewTabs";

type Loaded = {
  database: { id: string; title: string; icon: string | null };
  config: DbConfig;
  entries: EntryRow[];
};

export const linkedBlock = createReactBlockSpec(
  {
    type: "linked",
    propSchema: {
      databaseId: { default: "" },
      config: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <LinkedDatabase
        // Changer de base remonte le composant : rien de l'ancienne ne reste.
        key={block.props.databaseId}
        databaseId={block.props.databaseId}
        config={block.props.config}
        onPick={(databaseId) => editor.updateBlock(block.id, { props: { databaseId, config: "" } })}
        onConfig={(config) => editor.updateBlock(block.id, { props: { config } })}
      />
    ),
  },
);

type Props = { databaseId: string; config: string; onPick: (id: string) => void; onConfig: (config: string) => void };

function LinkedDatabase({ databaseId, config, onPick, onConfig }: Props) {
  const pages = usePageDirectory();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState("");
  // Saisies en avance sur le serveur, comme dans DatabaseView.
  const [edits, setEdits] = useState<Record<string, Values>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Dernière configuration voulue, avant que le bloc ne l'ait enregistrée : une
  // frappe de filtre puis un tri ne doivent pas se perdre l'un l'autre.
  const pending = useRef<LinkedConfig | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  // Un ancien bloc ne promeut ses vues qu'une fois par montage.
  const promoted = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  // La base, sa configuration et ses entrées : relues à chaque écriture, sans
  // passer par router.refresh (qui relancerait la page hôte). Chaque écriture
  // incrémente la version, que l'effet de lecture observe.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((count) => count + 1), []);

  useEffect(() => {
    if (!databaseId) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/databases/${databaseId}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) {
        setLoaded(null);
        setError(response?.status === 404 ? "Base introuvable : en corbeille ou supprimée." : "Base illisible pour le moment.");
        return;
      }
      const body = (await response.json()) as Loaded;
      if (cancelled) return;
      setError(null);
      setEdits({});
      setLoaded(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseId, version]);

  // Revenir sur la page après avoir changé la base ailleurs : la relire, sauf
  // si une saisie du bloc a le focus, pour ne pas effacer un brouillon.
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "hidden") return;
      const active = document.activeElement;
      if (root.current && active instanceof HTMLElement && root.current.contains(active)) return;
      reload();
    }
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  const properties = useMemo(() => loaded?.config.properties ?? [], [loaded]);
  const linked = useMemo(() => parseLinkedConfig(config), [config]);
  // Vues copiées par un ancien bloc, avant l'héritage.
  const legacy = useMemo(() => legacyLinkedViews(config), [config]);
  const baseViews = loaded?.config.views ?? [];
  // Les vues montrées sont celles de la base, chacune avec la surcharge que le
  // bloc porte pour elle. Aucun onglet local : la base fait référence.
  const views = useMemo(() => linkedViews(baseViews, linked, properties), [baseViews, linked, properties]);
  const view = pickView(views, activeId || linked.active);

  // Un ancien bloc portait des vues copiées, désormais ignorées. Une fois, on
  // ajoute à la base celles qu'elle n'a pas encore, puis le bloc adopte le
  // nouveau format : aucune vue réglée dans le bloc ne disparaît en silence.
  useEffect(() => {
    if (!loaded || promoted.current || legacy.length === 0) return;
    promoted.current = true;
    const missing = missingLegacyViews(baseViews, legacy, properties);
    const adopt = () => onConfig(linkedConfigText({ active: linked.active, overrides: {} }));
    if (missing.length === 0) {
      adopt();
      return;
    }
    void (async () => {
      const result = await send(`/api/databases/${loaded.database.id}`, "PATCH", {
        views: [...baseViews, ...missing],
        base: { views: baseViews },
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      adopt();
      reload();
    })();
  }, [loaded, baseViews, properties, legacy, linked.active, onConfig, reload]);

  function current(): LinkedConfig {
    return pending.current ?? linked;
  }

  function persist(next: LinkedConfig, delay = 0) {
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pending.current === next) pending.current = null;
      onConfig(linkedConfigText(next));
    }, delay);
  }

  // Choisir un onglet, et enregistrer ce choix dans le bloc.
  function selectView(id: string) {
    setActiveId(id);
    persist({ ...current(), active: id });
  }

  // Un réglage du bloc devient une surcharge de la vue, comparée à celle de la
  // base ; s'il rejoint la base, la surcharge disparaît. Seuls les champs que
  // ce geste vient de changer sont repris : une modification encore en attente
  // d'enregistrement n'est pas écrasée par le rendu précédent.
  function changeView(next: View, delay = 0) {
    const base = baseViews.find((item) => item.id === next.id);
    if (!base) return;
    const config = current();
    // La vue que vient de lire le panneau, et celle que la configuration en
    // attente montre déjà : l'écart entre les deux est le geste de l'utilisateur.
    const rendered = views.find((item) => item.id === next.id) ?? base;
    const shown = linkedViews(baseViews, config, properties).find((item) => item.id === next.id) ?? base;
    const merged = { ...shown, ...viewOverride(rendered, next) };
    persist(withLinkedOverride(config, next.id, viewOverride(base, merged)), delay);
  }

  function resetView() {
    persist(withoutLinkedOverride(current(), view.id));
  }

  function changeCalc(propId: string, op: CalcOp | null) {
    const calcs = { ...view.calcs };
    if (op) calcs[propId] = op;
    else delete calcs[propId];
    changeView({ ...view, calcs });
  }

  // Saisie d'une valeur : affichée tout de suite, puis envoyée à l'entrée de
  // la base source. Un refus rend l'état réel.
  function saveValue(entryId: string, propId: string, value: Value | null) {
    setMessage(null);
    setEdits((current) => {
      const base = current[entryId] ?? loaded?.entries.find((entry) => entry.id === entryId)?.values ?? {};
      const values = { ...base };
      if (value === null) delete values[propId];
      else values[propId] = value;
      return { ...current, [entryId]: values };
    });
    void send(`/api/entries/${entryId}`, "PATCH", { values: { [propId]: value } }).then((result) => {
      if (result.ok) return;
      setMessage(result.error);
      setEdits((current) => {
        const next = { ...current };
        delete next[entryId];
        return next;
      });
    });
  }

  // Titre écrit sur une carte du Kanban : la page source est modifiée, puis le
  // bloc relit la base.
  async function renameEntry(entryId: string, title: string): Promise<boolean> {
    setMessage(null);
    const result = await send(`/api/pages/${entryId}`, "PATCH", { title });
    if (!result.ok) {
      setMessage(result.error);
      return false;
    }
    reload();
    return true;
  }

  async function createEntry(values: Values = {}) {
    if (!loaded) return;
    setMessage(null);
    const result = await send("/api/entries", "POST", {
      dbId: loaded.database.id,
      values: { ...prefillValues(view, properties), ...values },
    });
    if (!result.ok) setMessage(result.error);
    else reload();
  }

  // Créer une entrée depuis le sélecteur d'une relation : elle naît dans la
  // base cible, sans quitter la page hôte.
  async function createLinkedEntry(prop: Property, title: string): Promise<string | null> {
    if (!prop.target) return null;
    setMessage(null);
    const result = await send("/api/entries", "POST", { dbId: prop.target, title });
    if (!result.ok) {
      setMessage(result.error);
      return null;
    }
    return String(result.data.id);
  }

  // Une option neuve appartient au schéma de la base : elle s'y écrit, puis
  // la base est relue pour que les vues du bloc se relisent contre elle.
  async function createOption(prop: Property, name: string): Promise<string | null> {
    const added = withNewOption(properties, prop.id, name);
    if (!added || !loaded) return null;
    const result = await send(`/api/databases/${loaded.database.id}`, "PATCH", { properties: added.properties });
    if (!result.ok) {
      setMessage(result.error);
      return null;
    }
    reload();
    return added.option.id;
  }

  async function moveCard(entryId: string, value: Value | null, order: string[]) {
    setMessage(null);
    const groupProp = properties.find((prop) => prop.id === view.group_by && isGroupableType(prop.type));
    const result = await send(`/api/entries/${entryId}`, "PATCH", { values: groupProp ? { [groupProp.id]: value } : {}, order });
    if (!result.ok) setMessage(result.error);
    else reload();
  }

  // Déplacement manuel d'une ligne : même ordre commun que le Kanban.
  async function moveEntry(entryId: string, place: OrderPlace) {
    if (!loaded) return;
    const ids = loaded.entries.map((entry) => entry.id);
    const order = moveInOrder(ids, entryId, place);
    if (order.every((id, index) => id === ids[index])) return;
    setMessage(null);
    const result = await send(`/api/entries/${entryId}`, "PATCH", { order });
    if (!result.ok) setMessage(result.error);
    else reload();
  }

  if (!databaseId) return <Picker pages={pages} onPick={onPick} />;
  if (error) return <p className="linked-panel linked-missing">{error}</p>;
  if (!loaded) return <p className="linked-panel">Chargement de la base…</p>;

  const live = loaded.entries.map((entry) => (edits[entry.id] ? { ...entry, values: edits[entry.id] } : entry));
  const timed = live.map((entry) => ({ ...entry, values: withTimes(properties, entry.values, entry) }));
  const visible = sortEntries(
    timed.filter((entry) => matchesFilters(entry, view.filters, properties)),
    view.kind === "board" ? [] : view.sorts,
    properties,
  );
  const hidden = live.length - visible.length;
  const groupProp = properties.find((prop) => prop.id === view.group_by && isGroupableType(prop.type)) ?? null;
  const boardColumns = groupProp ? groupEntries(timed, groupProp) : [];
  const dateProp = properties.find((prop) => prop.id === view.date_prop && prop.type === "date") ?? null;
  const shown = properties.filter((prop) => !view.hidden.includes(prop.id));

  return (
    <div className="linked-block" ref={root} contentEditable={false}>
      <div className="linked-bar">
        <Link href={`/db/${loaded.database.id}`} className="linked-title">
          <PageLabel row={{ ...loaded.database, type: "database" }} />
        </Link>
        {hidden > 0 && (
          <span className="badge" role="status">
            {hidden} {hidden > 1 ? "entrées masquées" : "entrée masquée"} par les filtres
          </span>
        )}
        {linked.overrides[view.id] && (
          <button type="button" className="ghost linked-reset" onClick={resetView}>
            Réglages locaux · Revenir à la base
          </button>
        )}
        <Link href={`/db/${loaded.database.id}`} className="linked-open">
          Ouvrir dans Bases ↗
        </Link>
      </div>
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      <ViewTabs views={views} activeId={view.id} properties={properties} onSelect={selectView} editable={false} />
      <ViewControls properties={properties} view={view} columns={boardColumns} onChange={changeView} />
      {view.kind === "table" && (
        <TableView
          properties={shown}
          entries={visible}
          filtered={view.filters.length > 0}
          sorts={view.sorts}
          onCycleSort={(propId) => changeView({ ...view, sorts: cycleSort(view.sorts, propId) })}
          canReorderEntries={view.sorts.length === 0}
          onMoveEntry={moveEntry}
          frozenFirstColumn={view.frozen_first_column}
          frozenHeader={view.frozen_header}
          columnWidths={view.column_widths}
          onColumnWidth={(propId, width, delay) => changeView(withColumnWidth(view, propId, width), delay)}
          onCreate={() => void createEntry()}
          onSave={saveValue}
          onCreateOption={createOption}
          onCreateEntry={createLinkedEntry}
          calcs={view.calcs}
          onCalc={changeCalc}
        />
      )}
      {view.kind === "list" && (
        <ListView properties={shown} entries={visible} filtered={view.filters.length > 0} onCreate={() => void createEntry()} />
      )}
      {view.kind === "gallery" && (
        <GalleryView
          properties={shown}
          entries={visible}
          filtered={view.filters.length > 0}
          onCreate={() => void createEntry()}
          cardSize={view.card_size}
          showTitle={view.show_title}
        />
      )}
      {view.kind === "calendar" &&
        (dateProp ? (
          <CalendarView
            dateProp={dateProp}
            scale={view.calendar_scale}
            entries={visible}
            onCreate={(values) => void createEntry(values)}
            onMove={(entryId, day) => saveValue(entryId, dateProp.id, day)}
          />
        ) : (
          <p className="hint">Le Calendrier de cette base n’a pas encore de propriété Date.</p>
        ))}
      {view.kind === "board" &&
        (groupProp ? (
          <KanbanView
            groupProp={groupProp}
            properties={shown}
            columnOrder={view.column_order[groupProp.id] ?? []}
            hiddenKeys={view.hidden_columns[groupProp.id] ?? []}
            collapsedKeys={view.collapsed_columns[groupProp.id] ?? []}
            entries={visible}
            allIds={loaded.entries.map((entry) => entry.id)}
            onCreate={(values) => void createEntry(values)}
            onMove={moveCard}
            onRename={renameEntry}
            onColumns={(patch) => changeView(withBoardColumns(view, groupProp.id, patch))}
          />
        ) : (
          <p className="hint">Le Kanban groupe les entrées par une propriété à valeurs discrètes.</p>
        ))}
    </div>
  );
}

// Base pas encore choisie : la liste de l'arbre, sans requête de plus.
function Picker({ pages, onPick }: { pages: ReadonlyMap<string, { id: string; type: string; title: string; icon: string | null }>; onPick: (id: string) => void }) {
  const databases = [...pages.values()]
    .filter((row) => row.type === "database")
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
  if (!databases.length) return <p className="linked-panel">Aucune base à afficher : créez-en une d’abord.</p>;
  return (
    <div className="linked-panel" contentEditable={false}>
      <label className="linked-picker">
        <span>Vue liée : choisir la base</span>
        <select defaultValue="" onChange={(event) => event.target.value && onPick(event.target.value)}>
          <option value="" disabled>
            Choisir une base…
          </option>
          {databases.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title || "Sans titre"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
