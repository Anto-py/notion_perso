"use client";
// Bloc « linked » : une base existante montrée dans une page, avec des vues
// propres au bloc. Les onglets, filtres, tris, colonnes et calculs vivent dans
// la propriété `config` du bloc (texte JSON, lib/views.ts parseLinkedConfig) ;
// les entrées et le schéma restent ceux de la base source, où les saisies
// s'écrivent. BRAINSTORMING §4, SPECS « views ».
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  groupEntries,
  isGroupableType,
  matchesFilters,
  sortEntries,
  withNewOption,
  withTimes,
  type EntryRow,
  type Property,
  type Value,
  type Values,
} from "@/lib/properties";
import {
  linkedConfigText,
  parseLinkedConfig,
  pickView,
  prefillValues,
  sanitizeViews,
  type CalcOp,
  type DbConfig,
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
  // Les vues de la base ont-elles déjà été copiées dans le bloc ?
  const seeded = useRef(false);
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

  const properties = useMemo(() => loaded?.config.properties ?? [], [loaded]);
  const linked = useMemo(() => parseLinkedConfig(config, properties), [config, properties]);
  // Avant que la configuration copiée ne soit enregistrée dans le bloc, les
  // vues montrées sont celles de la base, pour que le bloc s'ouvre déjà rempli.
  const views = config.trim() || !loaded ? linked.views : sanitizeViews(loaded.config.views, properties);
  const view = pickView(views, activeId || linked.active);

  // Une première ouverture copie les vues de la base dans le bloc : elles lui
  // appartiennent ensuite, et la base ne bouge plus. Le garde évite de réécrire
  // la configuration à chaque rendu tant que la propriété n'a pas suivi.
  useEffect(() => {
    if (!loaded || config.trim() || seeded.current) return;
    seeded.current = true;
    const views = sanitizeViews(loaded.config.views, properties);
    onConfig(linkedConfigText({ views, active: views[0].id }));
  }, [loaded, config, properties, onConfig]);

  function persist(next: View[], active = view.id, delay = 0) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onConfig(linkedConfigText({ views: next, active: pickView(next, active).id })), delay);
  }

  // Choisir un onglet, et enregistrer ce choix dans le bloc.
  function selectView(id: string, next: View[] = views) {
    setActiveId(id);
    persist(next, id);
  }

  function changeView(next: View, delay = 0) {
    persist(
      views.map((item) => (item.id === next.id ? next : item)),
      next.id,
      delay,
    );
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
    <div className="linked-block" contentEditable={false}>
      <div className="linked-bar">
        <Link href={`/db/${loaded.database.id}`} className="linked-title">
          <PageLabel row={{ ...loaded.database, type: "database" }} />
        </Link>
        {hidden > 0 && (
          <span className="badge" role="status">
            {hidden} {hidden > 1 ? "entrées masquées" : "entrée masquée"} par les filtres
          </span>
        )}
      </div>
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      <ViewTabs
        views={views}
        activeId={view.id}
        properties={properties}
        onSelect={selectView}
        onChange={(next, nextActive) => {
          const kept = next.some((item) => item.id === view.id) ? view.id : next[0].id;
          selectView(nextActive ?? kept, next);
        }}
      />
      <ViewControls properties={properties} view={view} columns={boardColumns} onChange={changeView} />
      {view.kind === "table" && (
        <TableView
          properties={shown}
          entries={visible}
          filtered={view.filters.length > 0}
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
            hiddenKeys={view.hidden_columns[groupProp.id] ?? []}
            entries={visible}
            allIds={loaded.entries.map((entry) => entry.id)}
            onCreate={(values) => void createEntry(values)}
            onMove={moveCard}
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
