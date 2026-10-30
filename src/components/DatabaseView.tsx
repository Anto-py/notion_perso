"use client";
// Base ouverte : titre, choix de la vue, filtres et tris, propriétés,
// entrées. Propriétés et entrées viennent du serveur et sont relues par
// router.refresh() après chaque écriture ; la vue (filtres, tris, type) vit
// ici pour réagir à la frappe, et s'enregistre en arrière-plan.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countLosses,
  defaultStatusOptions,
  isSingleOptionType,
  localId,
  matchesFilters,
  sortEntries,
  uniqueName,
  withNewOption,
  type DbConfig,
  type EntryRow,
  type Property,
  type Value,
  type Values,
  type View,
} from "@/lib/properties";
import { KanbanView } from "./KanbanView";
import { SaveIndicator, TitleField } from "./PageView";
import { PropertySchemaEditor } from "./PropertySchemaEditor";
import { send } from "./request";
import { TableView } from "./TableView";
import { useAutosave } from "./useAutosave";
import { ViewControls } from "./ViewControls";

type Props = {
  database: { id: string; title: string; icon: string | null };
  config: DbConfig;
  entries: EntryRow[];
};

type Pending = { properties: Property[]; losses: number };

export function DatabaseView({ database, config, entries }: Props) {
  const router = useRouter();
  const { status, queue, cancel } = useAutosave(database.id, (patch) => {
    if (patch.title !== undefined) router.refresh();
  });

  // Une configuration relue du serveur fait foi pour la vue aussi (filtres
  // retirés avec une propriété supprimée, par exemple).
  const [view, setView] = useState<View>(config.view);
  const [shownConfig, setShownConfig] = useState(config);
  // Les propriétés vivent aussi en local : créer une option depuis une cellule
  // doit apparaître sans recharger la page au milieu du geste (le choix de
  // l'option suit immédiatement sa création).
  const [localProperties, setLocalProperties] = useState(config.properties);
  if (config !== shownConfig) {
    setShownConfig(config);
    setView(config.view);
    setLocalProperties(config.properties);
  }

  const [schemaOpen, setSchemaOpen] = useState(config.properties.length === 0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(viewTimer.current), []);

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
  const groupProp = properties.find((prop) => prop.id === view.group_by && isSingleOptionType(prop.type)) ?? null;
  const valuesList = useMemo<Values[]>(() => live.map((entry) => entry.values), [live]);
  const visible = useMemo(
    () =>
      sortEntries(
        live.filter((entry) => matchesFilters(entry, view.filters, properties)),
        view.kind === "table" ? view.sorts : [],
        properties,
      ),
    [live, view, properties],
  );
  const hidden = live.length - visible.length;

  function changeView(next: View, delay = 0) {
    setView(next);
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(async () => {
      const result = await send(`/api/databases/${database.id}`, "PATCH", { view: next });
      if (!result.ok) setMessage(result.error);
    }, delay);
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

  async function createEntry(values: Values = {}) {
    setMessage(null);
    const result = await send("/api/entries", "POST", { dbId: database.id, values });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.push(`/page/${String(result.data.id)}`);
  }

  // Déplacement Kanban : valeur de groupe et ordre manuel partent dans la même
  // transaction, pour qu'une carte ne change jamais de colonne sans sa place.
  async function moveCard(entryId: string, value: string | null, order: string[]) {
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
      type: "status",
      options: defaultStatusOptions(),
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
        <button type="button" className="ghost" onClick={moveToTrash}>
          Supprimer la base
        </button>
      </div>
      <TitleField initial={database.title} ariaLabel="Titre de la base" onChange={(title) => queue({ title })} />

      <div className="db-toolbar">
        <div className="view-switch" role="group" aria-label="Type de vue">
          <button type="button" aria-pressed={view.kind === "table"} onClick={() => changeView({ ...view, kind: "table" })}>
            Tableau
          </button>
          <button type="button" aria-pressed={view.kind === "board"} onClick={() => changeView({ ...view, kind: "board" })}>
            Kanban
          </button>
        </div>
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

      <ViewControls properties={properties} view={view} onChange={changeView} />
      {view.kind === "table" && (
        <TableView
          properties={properties.filter((prop) => !view.hidden.includes(prop.id))}
          entries={visible}
          filtered={view.filters.length > 0}
          onCreate={() => createEntry()}
          onSave={saveValue}
          onCreateOption={createOption}
        />
      )}
      {view.kind === "board" &&
        (groupProp ? (
          <KanbanView
            groupProp={groupProp}
            entries={visible}
            allIds={entries.map((entry) => entry.id)}
            onCreate={createEntry}
            onMove={moveCard}
          />
        ) : (
          <div className="board-invite">
            <p>Le Kanban groupe les entrées par une propriété Statut ou Sélection.</p>
            <button type="button" onClick={createGroupProperty}>
              Créer la propriété « Statut »
            </button>
          </div>
        ))}
    </main>
  );
}
