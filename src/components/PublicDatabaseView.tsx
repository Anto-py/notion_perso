"use client";
// Une base en lecture seule, avec les gestes du visiteur (BRAINSTORMING §7) :
// chercher par le titre, filtrer, trier. État React seul : rien ne s'écrit,
// et quitter la base ou recharger le remet à zéro. Le serveur en fait le
// premier rendu, gestes vides : la base reste lisible sans JavaScript.
import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { MEDIA_BASE } from "@/lib/icons";
import { OP_LABELS, TITLE_PROP, filterOpsFor, opNeedsValue, type Filter, type FilterOp, type LinkRef, type Sort } from "@/lib/properties";
import {
  EMPTY_VISITOR,
  applyVisitor,
  presentOptions,
  relationChoices,
  visitorFilterable,
  visitorSortable,
  type PublicDatabaseData,
  type VisitorState,
} from "@/lib/public_view";
import { cardImage } from "@/lib/views";
import { PageIcon, PageLabel } from "./PageIcon";
import { ValueView } from "./propertyUi";
import { FilterValue } from "./ViewControls";

export function PublicDatabaseView({ data }: { data: PublicDatabaseData }) {
  const [state, setState] = useState<VisitorState>(EMPTY_VISITOR);
  // Next garde une page quittée en mémoire, état compris (<Activity>, avec
  // cacheComponents) : ses gestes s'effacent quand elle est masquée, pour
  // qu'un retour arrière retrouve la base telle que publiée.
  useLayoutEffect(() => () => setState(EMPTY_VISITOR), []);
  // Un lien du corps est un simple <a> : le retour arrière ressort la page du
  // cache du navigateur (bfcache), mémoire comprise. Même effacement.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setState(EMPTY_VISITOR);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  if (!data.entries.length) return <p className="hint">Cette base ne contient aucune entrée.</p>;
  const shown = applyVisitor(data.entries, data.columns, state);
  const active = state.query.trim() !== "" || state.filters.length > 0 || state.sorts.length > 0;
  return (
    <div className="public-db">
      <VisitorControls data={data} state={state} onChange={setState} />
      {active && (
        <p className="hint public-db-count" aria-live="polite">
          {shown.length} {shown.length > 1 ? "entrées" : "entrée"} sur {data.entries.length}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="hint">Aucune entrée ne correspond.</p>
      ) : data.view.kind === "gallery" ? (
        <PublicGallery data={data} entries={shown} />
      ) : (
        <PublicTable data={data} entries={shown} />
      )}
    </div>
  );
}

function VisitorControls({ data, state, onChange }: { data: PublicDatabaseData; state: VisitorState; onChange: (state: VisitorState) => void }) {
  const filterable = visitorFilterable(data.columns);
  const sortable = visitorSortable(data.columns);
  const unusedSort = sortable.find((key) => !state.sorts.some((sort) => sort.prop === key.id));
  const active = state.query !== "" || state.filters.length > 0 || state.sorts.length > 0;

  function setFilter(index: number, filter: Filter) {
    onChange({ ...state, filters: state.filters.map((f, i) => (i === index ? filter : f)) });
  }

  function setSort(index: number, sort: Sort) {
    onChange({ ...state, sorts: state.sorts.map((s, i) => (i === index ? sort : s)) });
  }

  return (
    <div className="view-controls public-controls">
      <div className="control-row">
        <input
          type="search"
          aria-label="Chercher par le titre"
          placeholder="Chercher…"
          value={state.query}
          maxLength={100}
          onChange={(event) => onChange({ ...state, query: event.target.value })}
        />
        <div className="control-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => onChange({ ...state, filters: [...state.filters, { prop: TITLE_PROP.id, op: "contains", value: "" }] })}
          >
            + Filtre
          </button>
          {unusedSort && (
            <button type="button" className="ghost" onClick={() => onChange({ ...state, sorts: [...state.sorts, { prop: unusedSort.id, dir: "asc" }] })}>
              + Tri
            </button>
          )}
          {active && (
            <button type="button" className="ghost" onClick={() => onChange(EMPTY_VISITOR)}>
              Tout effacer
            </button>
          )}
        </div>
      </div>

      {state.filters.map((filter, index) => {
        const prop = filterable.find((p) => p.id === filter.prop) ?? TITLE_PROP;
        return (
          <div className="control-row" key={index}>
            <span className="control-label">{index === 0 ? "Filtre" : "et"}</span>
            <select
              aria-label="Propriété filtrée"
              value={prop.id}
              onChange={(event) => {
                const next = filterable.find((p) => p.id === event.target.value) ?? TITLE_PROP;
                setFilter(index, { prop: next.id, op: filterOpsFor(next)[0], value: "" });
              }}
            >
              {filterable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select aria-label="Condition" value={filter.op} onChange={(event) => setFilter(index, { ...filter, op: event.target.value as FilterOp })}>
              {filterOpsFor(prop).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {opNeedsValue(filter.op) && (
              <FilterValue
                prop={prop}
                filter={filter}
                onChange={(value) => setFilter(index, { ...filter, value })}
                choices={{ options: presentOptions(data.entries, prop), entries: relationChoices(data.entries, prop) }}
              />
            )}
            <button
              type="button"
              className="ghost"
              aria-label="Retirer ce filtre"
              onClick={() => onChange({ ...state, filters: state.filters.filter((_, i) => i !== index) })}
            >
              ✕
            </button>
          </div>
        );
      })}

      {state.sorts.map((sort, index) => (
        <div className="control-row" key={sort.prop}>
          <span className="control-label">{index === 0 ? "Tri" : "puis"}</span>
          <select aria-label="Trier par" value={sort.prop} onChange={(event) => setSort(index, { ...sort, prop: event.target.value })}>
            {sortable
              .filter((key) => key.id === sort.prop || !state.sorts.some((s) => s.prop === key.id))
              .map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
          </select>
          <select aria-label="Sens du tri" value={sort.dir} onChange={(event) => setSort(index, { ...sort, dir: event.target.value as Sort["dir"] })}>
            <option value="asc">croissant</option>
            <option value="desc">décroissant</option>
          </select>
          <button
            type="button"
            className="ghost"
            aria-label="Retirer ce tri"
            onClick={() => onChange({ ...state, sorts: state.sorts.filter((_, i) => i !== index) })}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// L'image d'une carte peut vivre dans la copie d'une sauvegarde : sa base est
// réécrite, comme pour les liens du corps.
function withMediaBase(url: string, mediaBase: string): string {
  return mediaBase === MEDIA_BASE ? url : url.replaceAll(MEDIA_BASE, mediaBase);
}

function PublicGallery({ data, entries }: { data: PublicDatabaseData; entries: PublicDatabaseData["entries"] }) {
  const { view, mediaBase } = data;
  return (
    <ul className={`gallery-grid public-gallery gallery-${view.cardSize}`}>
      {entries.map((entry) => {
        const image = cardImage(entry);
        return (
          <li key={entry.id}>
            <Link href={data.entryHref[entry.id]} className="gallery-card">
              <span className="gallery-image">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={withMediaBase(image, mediaBase)} alt={view.showTitle ? "" : entry.title} loading="lazy" />
                ) : (
                  <span className="gallery-fallback">
                    <PageIcon icon={entry.icon} type="entry" big mediaBase={mediaBase} />
                  </span>
                )}
              </span>
              {view.showTitle && (
                <span className="gallery-title">
                  <PageLabel row={entry} mediaBase={mediaBase} />
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PublicTable({ data, entries }: { data: PublicDatabaseData; entries: PublicDatabaseData["entries"] }) {
  const { columns, mediaBase } = data;
  const link = (ref: LinkRef) => data.chipHref[ref.id] ?? null;
  return (
    <div className="table-wrap">
      <table className="db-table public-table">
        <thead>
          <tr>
            <th scope="col">Titre</th>
            {columns.map((prop) => (
              <th scope="col" key={prop.id}>
                {prop.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="cell-title">
                <Link href={data.entryHref[entry.id]}>
                  <PageLabel row={entry} mediaBase={mediaBase} />
                </Link>
              </td>
              {columns.map((prop) => (
                <td key={prop.id}>
                  <ValueView prop={prop} value={entry.values[prop.id]} links={entry.links?.[prop.id]} link={link} mediaBase={mediaBase} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
