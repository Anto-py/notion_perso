"use client";
// Filtres (combinés par « et ») et tris de la vue. Chaque changement remonte
// la vue entière ; delay > 0 pour une frappe, enregistrée après un temps de calme.
import {
  OP_LABELS,
  OPS_BY_TYPE,
  opNeedsValue,
  SORT_BUILTINS,
  TITLE_PROP,
  type Filter,
  type FilterOp,
  type Property,
  type Sort,
  type View,
} from "@/lib/properties";

type Props = { properties: Property[]; view: View; onChange: (view: View, delay?: number) => void };

const TYPING_DELAY = 500;

export function ViewControls({ properties, view, onChange }: Props) {
  const filterable = [TITLE_PROP, ...properties];
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

  return (
    <div className="view-controls">
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

      <div className="control-actions">
        <button type="button" className="ghost" onClick={() => onChange({ ...view, filters: [...view.filters, { prop: TITLE_PROP.id, op: "contains", value: "" }] })}>
          + Filtre
        </button>
        {view.kind === "table" && unusedSort && (
          <button type="button" className="ghost" onClick={() => onChange({ ...view, sorts: [...view.sorts, { prop: unusedSort.id, dir: "asc" }] })}>
            + Tri
          </button>
        )}
      </div>
    </div>
  );
}

function FilterValue({ prop, filter, onChange }: { prop: Property; filter: Filter; onChange: (value: string, delay?: number) => void }) {
  const value = filter.value ?? "";
  if (prop.type === "select" || prop.type === "multiselect") {
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
