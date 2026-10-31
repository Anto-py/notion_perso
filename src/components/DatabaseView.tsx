"use client";
// Base ouverte : titre, onglets des vues, filtres et tris, propriétés,
// entrées. Propriétés et entrées viennent du serveur et sont relues par
// router.refresh() après chaque écriture ; les vues (type, filtres, tris,
// calculs) vivent ici pour réagir à la frappe, et s'enregistrent en
// arrière-plan. La vue ouverte : celle de l'adresse (?vue=), sinon la
// dernière de cet appareil, sinon la première (BRAINSTORMING §4).
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countLosses,
  defaultSelectOptions,
  groupEntries,
  isGroupableType,
  localId,
  matchesFilters,
  sortEntries,
  uniqueName,
  withNewOption,
  withTimes,
  type EntryRow,
  type Property,
  type Value,
  type Values,
} from "@/lib/properties";
import { pickView, prefillValues, type CalcOp, type DbConfig, type View } from "@/lib/views";
import { IconPicker } from "./IconPicker";
import { CoverPicker } from "./CoverPicker";
import { KanbanView } from "./KanbanView";
import { ListView } from "./ListView";
import { SaveIndicator, TitleField } from "./PageView";
import { PropertySchemaEditor } from "./PropertySchemaEditor";
import { send } from "./request";
import { SharePanel } from "./SharePanel";
import { TableView } from "./TableView";
import { useAutosave } from "./useAutosave";
import { ViewControls } from "./ViewControls";
import { ViewTabs } from "./ViewTabs";

type Props = {
  database: {
    id: string;
    title: string;
    icon: string | null;
    cover: string | null;
    coverPosition: number | null;
    publicId: string | null;
  };
  config: DbConfig;
  entries: EntryRow[];
  // Vue demandée par l'adresse (?vue=), si elle existe encore.
  initialViewId: string | null;
};

type Pending = { properties: Property[]; losses: number };

// Mémoire de la dernière vue, propre à l'appareil (navigateur).
function storageKey(dbId: string): string {
  return `np_vue:${dbId}`;
}

function readStoredView(dbId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(dbId));
  } catch {
    return null;
  }
}

export function DatabaseView({ database, config, entries, initialViewId }: Props) {
  const router = useRouter();
  const { status, queue, cancel } = useAutosave(database.id, (patch) => {
    if (patch.title !== undefined) router.refresh();
  });

  // Une configuration relue du serveur fait foi pour les vues aussi (filtres
  // retirés avec une propriété supprimée, par exemple).
  const [views, setViews] = useState<View[]>(config.views);
  const [activeId, setActiveId] = useState(() => pickView(config.views, initialViewId).id);
  const [shownConfig, setShownConfig] = useState(config);
  // Les propriétés vivent aussi en local : créer une option depuis une cellule
  // doit apparaître sans recharger la page au milieu du geste (le choix de
  // l'option suit immédiatement sa création).
  const [localProperties, setLocalProperties] = useState(config.properties);
  if (config !== shownConfig) {
    setShownConfig(config);
    setViews(config.views);
    setLocalProperties(config.properties);
  }
  const view = pickView(views, activeId);

  const [schemaOpen, setSchemaOpen] = useState(config.properties.length === 0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(viewTimer.current), []);

  // Sans vue dans l'adresse, l'appareil rouvre sa dernière vue. Lu après le
  // premier rendu : le serveur ne connaît pas localStorage.
  useEffect(() => {
    if (initialViewId && config.views.some((item) => item.id === initialViewId)) return;
    const stored = readStoredView(database.id);
    if (stored && stored !== config.views[0].id && config.views.some((item) => item.id === stored)) selectView(stored);
    // Une seule fois, à l'ouverture de la base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L'adresse suit la vue sans navigation : router.replace relancerait la page
  // serveur et sa configuration écraserait un réglage pas encore enregistré.
  function selectView(id: string) {
    setActiveId(id);
    try {
      window.localStorage.setItem(storageKey(database.id), id);
    } catch {
      // Stockage refusé (navigation privée) : seule la mémoire se perd.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("vue", id);
    window.history.replaceState(null, "", url);
  }

  // Valeurs saisies dans le tableau, en avance sur le serveur : le rendu
  // immédiat garde le focus du champ. Toute liste relue du serveur les efface.
  const [shownEntries, setShownEntries] = useState(entries);
  const [edits, setEdits] = useState<Record<string, Values>>({});
  if (entries !== shownEntries) {
    setShownEntries(entries);
    setEdits({});
  }
  const live = useMemo(
    () => (entries === shownEntries ? entries.map((entry) => (edits[entry.id] ? { ...entry, values: edits[entry.id] } : entry)) : entries),
    [entries, shownEntries, edits],
  );

  const properties = localProperties;
  // Créé le et Modifié le, tirés de l'entrée, pour l'affichage et les calculs.
  const timed = useMemo(() => live.map((entry) => ({ ...entry, values: withTimes(properties, entry.values, entry) })), [live, properties]);
  const groupProp = properties.find((prop) => prop.id === view.group_by && isGroupableType(prop.type)) ?? null;
  const valuesList = useMemo<Values[]>(() => live.map((entry) => entry.values), [live]);
  const visible = useMemo(
    () =>
      sortEntries(
        timed.filter((entry) => matchesFilters(entry, view.filters, properties)),
        view.kind === "board" ? [] : view.sorts,
        properties,
      ),
    [timed, view, properties],
  );
  const hidden = live.length - visible.length;
  // Colonnes du Kanban calculées sur toutes les entrées, filtres compris : une
  // colonne ne doit pas disparaître du menu de masquage quand un filtre vide
  // ses cartes.
  const boardColumns = useMemo(() => (groupProp ? groupEntries(timed, groupProp) : []), [timed, groupProp]);

  // Toute modification renvoie la liste complète des vues ; une frappe
  // (delay > 0) n'est envoyée qu'après un temps de calme.
  function saveViews(next: View[], delay = 0) {
    setViews(next);
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(async () => {
      const result = await send(`/api/databases/${database.id}`, "PATCH", { views: next });
      if (!result.ok) setMessage(result.error);
    }, delay);
  }

  function changeView(next: View, delay = 0) {
    saveViews(
      views.map((item) => (item.id === next.id ? next : item)),
      delay,
    );
  }

  function changeCalc(propId: string, op: CalcOp | null) {
    const calcs = { ...view.calcs };
    if (op) calcs[propId] = op;
    else delete calcs[propId];
    changeView({ ...view, calcs });
  }

  // Une perte de valeurs (option ou propriété supprimée, type changé) attend
  // une confirmation, affichée dans la page plutôt qu'en boîte de dialogue.
  async function saveProperties(next: Property[], confirmed = false) {
    setMessage(null);
    const losses = countLosses(properties, next, valuesList);
    if (losses > 0 && !confirmed) {
      setPending({ properties: next, losses });
      return;
    }
    setPending(null);
    const result = await send(`/api/databases/${database.id}`, "PATCH", { properties: next });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  // Une entrée créée depuis une vue filtrée porte les valeurs que ses filtres
  // imposent, pour y rester visible ; la colonne Kanban l'emporte.
  async function createEntry(values: Values = {}) {
    setMessage(null);
    const result = await send("/api/entries", "POST", { dbId: database.id, values: { ...prefillValues(view, properties), ...values } });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.push(`/page/${String(result.data.id)}`);
  }

  // Déplacement Kanban : valeur de groupe et ordre manuel partent dans la même
  // transaction, pour qu'une carte ne change jamais de colonne sans sa place.
  async function moveCard(entryId: string, value: Value | null, order: string[]) {
    setMessage(null);
    const values = groupProp ? { [groupProp.id]: value } : {};
    const result = await send(`/api/entries/${entryId}`, "PATCH", { values, order });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  // Une base sans propriété de regroupement ne peut pas se grouper : on en
  // propose une, avec trois options de départ, que l'éditeur de propriétés
  // permet ensuite de renommer, colorer ou compléter.
  async function createGroupProperty() {
    const statut: Property = {
      id: localId("prop"),
      name: uniqueName(properties, "Statut"),
      type: "select",
      options: defaultSelectOptions(),
    };
    // Le serveur rattache la vue à la première propriété groupable.
    await saveProperties([...properties, statut]);
  }

  // Saisie dans une cellule du tableau : la valeur est affichée tout de suite,
  // puis envoyée. Un refus du serveur efface l'avance et rend l'état réel.
  function saveValue(entryId: string, propId: string, value: Value | null) {
    setMessage(null);
    setEdits((current) => {
      const base = current[entryId] ?? entries.find((entry) => entry.id === entryId)?.values ?? {};
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

  // Créer une option depuis une cellule l'ajoute d'abord à la base (schéma
  // commun), puis la choisit pour cette entrée seulement.
  async function createOption(prop: Property, name: string): Promise<string | null> {
    const added = withNewOption(properties, prop.id, name);
    if (!added) return null;
    const result = await send(`/api/databases/${database.id}`, "PATCH", { properties: added.properties });
    if (!result.ok) {
      setMessage(result.error);
      return null;
    }
    setLocalProperties(added.properties);
    return added.option.id;
  }

  async function moveToTrash() {
    cancel();
    const result = await send(`/api/pages/${database.id}`, "DELETE");
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="page page-wide">
      <div className="page-bar">
        <SaveIndicator status={status} />
        <SharePanel pageId={database.id} initialPublicId={database.publicId} />
        <button type="button" className="ghost" onClick={moveToTrash}>
          Supprimer la base
        </button>
      </div>
      <CoverPicker pageId={database.id} initial={database.cover} initialPosition={database.coverPosition} />
      <IconPicker pageId={database.id} type="database" initial={database.icon} />
      <TitleField initial={database.title} ariaLabel="Titre de la base" onChange={(title) => queue({ title })} />

      <ViewTabs
        views={views}
        activeId={view.id}
        properties={properties}
        onSelect={selectView}
        onChange={(next, nextActive) => {
          saveViews(next);
          if (nextActive) selectView(nextActive);
          else if (!next.some((item) => item.id === view.id)) selectView(next[0].id);
        }}
      />
      <div className="db-toolbar">
        <button type="button" aria-expanded={schemaOpen} onClick={() => setSchemaOpen(!schemaOpen)}>
          Propriétés ({properties.length})
        </button>
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
      {pending && (
        <div className="confirm-bar" role="alert">
          <span>
            Ce changement efface une valeur dans {pending.losses} {pending.losses > 1 ? "entrées" : "entrée"}.
          </span>
          <button type="button" className="danger" onClick={() => saveProperties(pending.properties, true)}>
            Confirmer
          </button>
          <button type="button" className="ghost" onClick={() => setPending(null)}>
            Annuler
          </button>
        </div>
      )}
      {schemaOpen && <PropertySchemaEditor properties={properties} valuesList={valuesList} onChange={(next) => saveProperties(next)} />}

      <ViewControls properties={properties} view={view} columns={boardColumns} onChange={changeView} />
      {view.kind === "table" && (
        <TableView
          properties={properties.filter((prop) => !view.hidden.includes(prop.id))}
          entries={visible}
          filtered={view.filters.length > 0}
          onCreate={() => createEntry()}
          onSave={saveValue}
          onCreateOption={createOption}
          calcs={view.calcs}
          onCalc={changeCalc}
        />
      )}
      {view.kind === "list" && (
        <ListView
          properties={properties.filter((prop) => !view.hidden.includes(prop.id))}
          entries={visible}
          filtered={view.filters.length > 0}
          onCreate={() => createEntry()}
        />
      )}
      {view.kind === "board" &&
        (groupProp ? (
          <KanbanView
            groupProp={groupProp}
            properties={properties.filter((prop) => !view.hidden.includes(prop.id))}
            hiddenKeys={view.hidden_columns[groupProp.id] ?? []}
            entries={visible}
            allIds={entries.map((entry) => entry.id)}
            onCreate={createEntry}
            onMove={moveCard}
          />
        ) : (
          <div className="board-invite">
            <p>Le Kanban groupe les entrées par une propriété à valeurs discrètes : Sélection, Sélection multiple ou Case à cocher.</p>
            <button type="button" onClick={createGroupProperty}>
              Créer la propriété « Statut »
            </button>
          </div>
        ))}
    </main>
  );
}
