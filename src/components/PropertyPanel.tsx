"use client";
// Propriétés d'une entrée, en haut de sa page. Chaque changement part tout
// de suite (texte et lien : en quittant le champ), un envoi à la fois pour
// que deux clics rapides arrivent dans l'ordre. Créer une option l'ajoute
// d'abord à la base, puis la choisit.
import Link from "next/link";
import { useRef, useState } from "react";
import { localId, nextColor, type DbConfig, type Property, type Value, type Values } from "@/lib/properties";
import { CommitInput } from "./CommitInput";
import { OptionPicker } from "./OptionPicker";
import { isWebUrl, TYPE_ICONS } from "./propertyUi";
import { send } from "./request";

type Props = { dbId: string; entryId: string; properties: Property[]; values: Values };

export function PropertyPanel({ dbId, entryId, properties: initialProperties, values: initialValues }: Props) {
  const [properties, setProperties] = useState(initialProperties);
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function save(propId: string, value: Value | null) {
    setValues((previous) => {
      const next = { ...previous };
      if (value === null) delete next[propId];
      else next[propId] = value;
      return next;
    });
    queue.current = queue.current.then(async () => {
      const result = await send(`/api/entries/${entryId}`, "PATCH", { values: { [propId]: value } });
      setError(result.ok ? null : result.error);
    });
  }

  async function createOption(prop: Property, name: string): Promise<string | null> {
    const option = { id: localId("opt"), name, color: nextColor(prop.options ?? []) };
    const next = properties.map((p) => (p.id === prop.id ? { ...p, options: [...(p.options ?? []), option] } : p));
    const result = await send(`/api/databases/${dbId}`, "PATCH", { properties: next });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setProperties((result.data.config as DbConfig).properties);
    return option.id;
  }

  if (properties.length === 0) {
    return (
      <p className="hint props-empty">
        Cette base n&apos;a pas encore de propriétés. <Link href={`/db/${dbId}`}>Les définir depuis la base</Link>
      </p>
    );
  }

  return (
    <div className="props">
      {properties.map((prop) => (
        <div className="prop-row" key={prop.id}>
          <span className="prop-name">
            <span className="prop-icon" aria-hidden="true">
              {TYPE_ICONS[prop.type]}
            </span>
            {prop.name}
          </span>
          <div className="prop-value">
            <PropertyInput prop={prop} value={values[prop.id]} onSave={(value) => save(prop.id, value)} onCreate={(name) => createOption(prop, name)} />
          </div>
        </div>
      ))}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = {
  prop: Property;
  value: Value | undefined;
  onSave: (value: Value | null) => void;
  onCreate: (name: string) => Promise<string | null>;
};

function PropertyInput({ prop, value, onSave, onCreate }: InputProps) {
  const text = typeof value === "string" ? value : "";
  switch (prop.type) {
    case "text":
      return <CommitInput className="prop-input" aria-label={prop.name} placeholder="Vide" value={text} maxLength={5000} onCommit={(next) => onSave(next || null)} />;
    case "url":
      return (
        <span className="prop-url">
          <CommitInput
            className="prop-input"
            aria-label={prop.name}
            placeholder="https://…"
            inputMode="url"
            value={text}
            maxLength={2048}
            onCommit={(next) => onSave(next || null)}
          />
          {isWebUrl(text) && (
            <a href={text} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${prop.name}`}>
              ↗
            </a>
          )}
        </span>
      );
    case "date":
      return <input type="date" className="prop-input" aria-label={prop.name} value={text} onChange={(event) => onSave(event.target.value || null)} />;
    case "checkbox":
      return <input type="checkbox" aria-label={prop.name} checked={value === true} onChange={(event) => onSave(event.target.checked ? true : null)} />;
    case "select":
      return (
        <OptionPicker
          prop={prop}
          selected={text ? [text] : []}
          multiple={false}
          onChange={(ids) => onSave(ids[0] ?? null)}
          onCreate={onCreate}
        />
      );
    case "multiselect":
      return (
        <OptionPicker
          prop={prop}
          selected={Array.isArray(value) ? value : []}
          multiple
          onChange={(ids) => onSave(ids.length > 0 ? ids : null)}
          onCreate={onCreate}
        />
      );
  }
}
