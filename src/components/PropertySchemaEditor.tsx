"use client";
// Propriétés d'une base : nom, type, options et couleurs. Chaque geste remonte
// la liste complète voulue ; DatabaseView compte les valeurs perdues, demande
// confirmation s'il y en a, puis enregistre.
import {
  changeType,
  COLOR_LABELS,
  localId,
  nextColor,
  OPTION_COLORS,
  PROPERTY_TYPES,
  STATUS_GROUPS,
  STATUS_GROUP_LABELS,
  TYPE_LABELS,
  uniqueName,
  type OptionColor,
  type Property,
  type PropertyType,
  type SelectOption,
  type StatusGroup,
  type Values,
} from "@/lib/properties";
import { CommitInput } from "./CommitInput";
import { OptionChip } from "./propertyUi";

type Props = { properties: Property[]; valuesList: Values[]; onChange: (next: Property[]) => void };

export function PropertySchemaEditor({ properties, valuesList, onChange }: Props) {
  function update(id: string, change: (prop: Property) => Property) {
    onChange(properties.map((prop) => (prop.id === id ? change(prop) : prop)));
  }

  return (
    <section className="schema" aria-label="Propriétés de la base">
      {properties.length === 0 && <p className="hint">Aucune propriété. Ajoutez-en une pour décrire les entrées : tags, statut, date, lien…</p>}
      {properties.map((prop) => (
        <div className="schema-prop" key={prop.id}>
          <div className="schema-head">
            <CommitInput
              key={prop.name}
              className="schema-name"
              aria-label="Nom de la propriété"
              value={prop.name}
              maxLength={100}
              allowEmpty={false}
              onCommit={(name) => update(prop.id, (p) => ({ ...p, name }))}
            />
            <select
              aria-label={`Type de ${prop.name}`}
              value={prop.type}
              onChange={(event) => update(prop.id, (p) => changeType(p, event.target.value as PropertyType, valuesList))}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={() => onChange(properties.filter((p) => p.id !== prop.id))}>
              Supprimer
            </button>
          </div>
          {prop.options && <OptionsEditor prop={prop} onChange={(options) => update(prop.id, (p) => ({ ...p, options }))} />}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...properties, { id: localId("prop"), name: uniqueName(properties, "Propriété"), type: "text" }])}>
        + Propriété
      </button>
    </section>
  );
}

function OptionsEditor({ prop, onChange }: { prop: Property; onChange: (options: SelectOption[]) => void }) {
  const options = prop.options ?? [];

  function update(id: string, change: Partial<SelectOption>) {
    onChange(options.map((option) => (option.id === id ? { ...option, ...change } : option)));
  }

  return (
    <ul className="schema-options" aria-label={`Options de ${prop.name}`}>
      {options.map((option) => (
        <li key={option.id}>
          <OptionChip option={option} />
          <CommitInput
            key={option.name}
            aria-label={`Renommer l'option ${option.name}`}
            value={option.name}
            maxLength={100}
            allowEmpty={false}
            onCommit={(name) => update(option.id, { name })}
          />
          <select aria-label={`Couleur de ${option.name}`} value={option.color} onChange={(event) => update(option.id, { color: event.target.value as OptionColor })}>
            {OPTION_COLORS.map((color) => (
              <option key={color} value={color}>
                {COLOR_LABELS[color]}
              </option>
            ))}
          </select>
          {prop.type === "status" && (
            <select
              aria-label={`Groupe de ${option.name}`}
              value={option.group ?? "todo"}
              onChange={(event) => update(option.id, { group: event.target.value as StatusGroup })}
            >
              {STATUS_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {STATUS_GROUP_LABELS[group]}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="ghost" aria-label={`Supprimer l'option ${option.name}`} onClick={() => onChange(options.filter((o) => o.id !== option.id))}>
            ✕
          </button>
        </li>
      ))}
      <li>
        <CommitInput
          // Recréé vide après chaque ajout.
          key={options.length}
          aria-label={`Nouvelle option de ${prop.name}`}
          placeholder="+ Nouvelle option"
          value=""
          maxLength={100}
          onCommit={(name) => {
            if (!name) return;
            const option: SelectOption = { id: localId("opt"), name, color: nextColor(options) };
            if (prop.type === "status") option.group = "todo";
            onChange([...options, option]);
          }}
        />
      </li>
    </ul>
  );
}
