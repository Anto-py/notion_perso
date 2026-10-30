"use client";
// Filtres (combinés par « et »), tris et colonnes affichées de la vue. Chaque
// changement remonte la vue entière ; delay > 0 pour une frappe, enregistrée
// après un temps de calme.
import { useState } from "react";
import {
  isGroupableType,
  isOptionType,
  NO_COLUMN,
  OP_LABELS,
  OPS_BY_TYPE,
  opNeedsValue,
  SORT_BUILTINS,
  TITLE_PROP,
  type Column,
  type Filter,
  type FilterOp,
  type Property,
  type Sort,
  type View,
} from "@/lib/properties";

type Props = { properties: Property[]; view: View; columns: Column[]; onChange: (view: View, delay?: number) => void };

const TYPING_DELAY = 500;

export function ViewControls({ properties, view, columns, onChange }: Props) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [boardColumnsOpen, setBoardColumnsOpen] = useState(false);
  const filterable = [TITLE_PROP, ...properties];
  const groupables = properties.filter((prop) => isGroupableType(prop.type));
  const groupProp = groupables.find((prop) => prop.id === view.group_by) ?? groupables[0];
  const hiddenColumnKeys = new Set(groupProp ? (view.hidden_columns[groupProp.id] ?? []) : []);
  const hiddenColumnCount = columns.filter((column) => hiddenColumnKeys.has(column.key ?? NO_COLUMN)).length;
  const sortable = [
    ...Object.entries(SORT_BUILTINS).map(([id, name]) => ({ id, name })),
    ...properties.map(({ id, name }) => ({ id, name })),
  ];

  function setFilter(index: number, filter: Filter, delay = 0) {
    onChange({ ...view, filters: view.filters.map((f, i) => (i === index ? filter : f)) }, delay);
  }

  function setSort(index: number, sort: Sort) {
    onChange({ ...view, sorts: view.sorts.map((s, i) => (i === index ? sort : s)) });
  }

  const unusedSort = sortable.find((key) => !view.sorts.some((sort) => sort.prop === key.id));

  function setShown(propId: string, shown: boolean) {
    onChange({ ...view, hidden: shown ? view.hidden.filter((id) => id !== propId) : [...view.hidden, propId] });
  }

  function setColumnShown(propId: string, key: string, shown: boolean) {
    const current = view.hidden_columns[propId] ?? [];
    const next = shown ? current.filter((item) => item !== key) : [...current, key];
    onChange({ ...view, hidden_columns: { ...view.hidden_columns, [propId]: next } });
  }

  return (
    <div className="view-controls">
      {view.kind === "board" && groupables.length > 0 && (
        <div className="control-row">
          <span className="control-label">Regroupement</span>
          <select
            aria-label="Propriété de regroupement"
            value={view.group_by ?? groupables[0].id}
            onChange={(event) => onChange({ ...view, group_by: event.target.value })}
          >
            {groupables.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {view.filters.map((filter, index) => {
        const prop = filterable.find((p) => p.id === filter.prop) ?? TITLE_PROP;
        return (
          <div className="control-row" key={index}>
            <span className="control-label">{index === 0 ? "Filtre" : "et"}</span>
            <select
              aria-label="Propriété filtrée"
              value={prop.id}
              onChange={(event) => {
                const next = filterable.find((p) => p.id === event.target.value) ?? TITLE_PROP;
                setFilter(index, { prop: next.id, op: OPS_BY_TYPE[next.type][0], value: "" });
              }}
            >
              {filterable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select aria-label="Condition" value={filter.op} onChange={(event) => setFilter(index, { ...filter, op: event.target.value as FilterOp })}>
              {OPS_BY_TYPE[prop.type].map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {opNeedsValue(filter.op) && <FilterValue prop={prop} filter={filter} onChange={(value, delay) => setFilter(index, { ...filter, value }, delay)} />}
            <button type="button" className="ghost" aria-label="Retirer ce filtre" onClick={() => onChange({ ...view, filters: view.filters.filter((_, i) => i !== index) })}>
              ✕
            </button>
          </div>
        );
      })}

      {view.kind === "table" &&
        view.sorts.map((sort, index) => (
          <div className="control-row" key={sort.prop}>
            <span className="control-label">{index === 0 ? "Tri" : "puis"}</span>
            <select aria-label="Trier par" value={sort.prop} onChange={(event) => setSort(index, { ...sort, prop: event.target.value })}>
              {sortable
                .filter((key) => key.id === sort.prop || !view.sorts.some((s) => s.prop === key.id))
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
            <button type="button" className="ghost" aria-label="Retirer ce tri" onClick={() => onChange({ ...view, sorts: view.sorts.filter((_, i) => i !== index) })}>
              ✕
            </button>
          </div>
        ))}

      {columnsOpen && properties.length > 0 && (
        <div className="control-row" role="group" aria-label={view.kind === "table" ? "Colonnes affichées" : "Champs affichés sur les cartes"}>
          <span className="control-label">{view.kind === "table" ? "Colonnes" : "Champs"}</span>
          {properties.map((prop) => (
            <label key={prop.id} className="column-toggle">
              <input type="checkbox" checked={!view.hidden.includes(prop.id)} onChange={(event) => setShown(prop.id, event.target.checked)} />
              {prop.name}
            </label>
          ))}
          {view.kind === "board" && groupProp && (
            <span className="hint">La propriété de regroupement fait les colonnes et reste absente des cartes.</span>
          )}
        </div>
      )}

      {view.kind === "board" && groupProp && boardColumnsOpen && (
        <div className="control-row" role="group" aria-label="Colonnes du Kanban">
          <span className="control-label">Colonnes</span>
          {columns.map((column) => {
            const key = column.key ?? NO_COLUMN;
            return (
              <label key={key} className="column-toggle">
                <input
                  type="checkbox"
                  checked={!hiddenColumnKeys.has(key)}
                  onChange={(event) => setColumnShown(groupProp.id, key, event.target.checked)}
                />
                {column.name}
              </label>
            );
          })}
        </div>
      )}

      <div className="control-actions">
        <button type="button" className="ghost" onClick={() => onChange({ ...view, filters: [...view.filters, { prop: TITLE_PROP.id, op: "contains", value: "" }] })}>
          + Filtre
        </button>
        {view.kind === "table" && unusedSort && (
          <button type="button" className="ghost" onClick={() => onChange({ ...view, sorts: [...view.sorts, { prop: unusedSort.id, dir: "asc" }] })}>
            + Tri
          </button>
        )}
        {view.kind === "board" && groupProp && (
          <button type="button" className="ghost" aria-expanded={boardColumnsOpen} onClick={() => setBoardColumnsOpen(!boardColumnsOpen)}>
            Colonnes du Kanban
            {hiddenColumnCount > 0 && ` (${hiddenColumnCount} ${hiddenColumnCount > 1 ? "masquées" : "masquée"})`}
          </button>
        )}
        {properties.length > 0 && (
          <button type="button" className="ghost" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(!columnsOpen)}>
            {view.kind === "table" ? "Colonnes" : "Champs des cartes"}
            {view.hidden.length > 0 &&
              ` (${view.hidden.length} ${
                view.kind === "table" ? (view.hidden.length > 1 ? "masquées" : "masquée") : view.hidden.length > 1 ? "masqués" : "masqué"
              })`}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterValue({ prop, filter, onChange }: { prop: Property; filter: Filter; onChange: (value: string, delay?: number) => void }) {
  const value = filter.value ?? "";
  // Le filtre compare des ids d'option : une sélection se choisit dans sa
  // liste, jamais en texte libre.
  if (isOptionType(prop.type)) {
    return (
      <select aria-label="Valeur du filtre" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">choisir…</option>
        {(prop.options ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "date") {
    return <input type="date" aria-label="Date du filtre" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return (
    <input
      aria-label="Texte du filtre"
      placeholder="texte…"
      value={value}
      maxLength={100}
      onChange={(event) => onChange(event.target.value, TYPING_DELAY)}
    />
  );
}
