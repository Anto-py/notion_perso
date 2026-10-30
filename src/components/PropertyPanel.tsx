"use client";
// Propriétés d'une entrée, en haut de sa page. Le schéma de la base (noms,
// types, options) est commun ; seules les valeurs sont propres à l'entrée.
// Chaque changement part tout de suite (texte et lien : en quittant le champ),
// un envoi à la fois pour que deux clics rapides arrivent dans l'ordre. Créer
// une option l'ajoute d'abord à la base, puis la choisit. Une entrée peut
// aussi changer de base : les propriétés de même nom et type suivent.
import Link from "next/link";
import { useRef, useState } from "react";
import { withNewOption, type DbConfig, type Property, type Value, type Values } from "@/lib/properties";
import { MoveToDatabase } from "./MoveToDatabase";
import { PropertyInput } from "./PropertyInput";
import { TYPE_ICONS } from "./propertyUi";
import { send } from "./request";

type Props = {
  dbId: string;
  entryId: string;
  properties: Property[];
  values: Values;
  databases: { id: string; title: string; icon: string | null }[];
};

export function PropertyPanel({ dbId, entryId, properties: initialProperties, values: initialValues, databases }: Props) {
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
    const added = withNewOption(properties, prop.id, name);
    if (!added) return null;
    const result = await send(`/api/databases/${dbId}`, "PATCH", { properties: added.properties });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setProperties((result.data.config as DbConfig).properties);
    return added.option.id;
  }

  return (
    <div className="props">
      {properties.length === 0 && (
        <p className="hint props-empty">
          Cette base n&apos;a pas encore de propriétés. <Link href={`/db/${dbId}`}>Les définir depuis la base</Link>
        </p>
      )}
      {properties.map((prop) => (
        <div className="prop-row" key={prop.id}>
          <span className="prop-name">
            <span className="prop-icon" aria-hidden="true">
              {TYPE_ICONS[prop.type]}
            </span>
            {prop.name}
          </span>
          <div className="prop-value">
            <PropertyInput
              prop={prop}
              value={values[prop.id]}
              onSave={(value) => save(prop.id, value)}
              onCreate={(name) => createOption(prop, name)}
            />
          </div>
        </div>
      ))}
      <MoveToDatabase entryId={entryId} databases={databases} />
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
