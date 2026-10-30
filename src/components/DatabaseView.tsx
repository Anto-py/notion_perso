"use client";
// Base ouverte : titre, choix de la vue, filtres et tris, propriétés,
// entrées. Propriétés et entrées viennent du serveur et sont relues par
// router.refresh() après chaque écriture ; la vue (filtres, tris, type) vit
// ici pour réagir à la frappe, et s'enregistre en arrière-plan.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countLosses,
  matchesFilters,
  sortEntries,
  type DbConfig,
  type EntryRow,
  type Property,
  type Values,
  type View,
} from "@/lib/properties";
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
  if (config !== shownConfig) {
    setShownConfig(config);
    setView(config.view);
  }

  const [schemaOpen, setSchemaOpen] = useState(config.properties.length === 0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(viewTimer.current), []);

  const { properties } = config;
  const valuesList = useMemo<Values[]>(() => entries.map((entry) => entry.values), [entries]);
  const visible = useMemo(
    () =>
      sortEntries(
        entries.filter((entry) => matchesFilters(entry, view.filters, properties)),
        view.kind === "table" ? view.sorts : [],
        properties,
      ),
    [entries, view, properties],
  );
  const hidden = entries.length - visible.length;

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
          <button type="button" disabled title="Prochaine étape">
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
      <TableView properties={properties} entries={visible} filtered={view.filters.length > 0} onCreate={() => createEntry()} />
    </main>
  );
}
