"use client";
// Propriétés d'une base : nom, type, options et couleurs. Chaque geste remonte
// la liste complète voulue ; DatabaseView compte les valeurs perdues, demande
// confirmation s'il y en a, puis enregistre.
import {
  changeType,
  COLOR_LABELS,
  FORMAT_LABELS,
  NUMBER_FORMATS,
  isSingleOptionType,
  isTwin,
  localId,
  nextColor,
  OPTION_COLORS,
  PROPERTY_TYPES,
  TYPE_LABELS,
  uniqueName,
  type NumberFormat,
  type OptionColor,
  type Property,
  type PropertyType,
  type SelectOption,
  type Values,
} from "@/lib/properties";
import { CommitInput } from "./CommitInput";
import { OptionChip } from "./propertyUi";
import { RollupEditor } from "./RollupEditor";

type Props = {
  properties: Property[];
  valuesList: Values[];
  // Les bases de l'arbre, cibles possibles d'une relation (la base courante
  // comprise) ; lues par le serveur, l'annuaire du bloc lié ne les portant pas.
  databases: { id: string; title: string; icon: string | null }[];
  onChange: (next: Property[]) => void;
};

export function PropertySchemaEditor({ properties, valuesList, databases, onChange }: Props) {

  function update(id: string, change: (prop: Property) => Property) {
    onChange(properties.map((prop) => (prop.id === id ? change(prop) : prop)));
  }

  // Supprimer une relation emporte les cumuls qui la traversent : sans elle,
  // ils n'auraient plus rien à lire et le serveur refuserait la liste.
  function removeProperty(id: string) {
    onChange(properties.filter((prop) => prop.id !== id && !(prop.type === "rollup" && prop.relation === id)));
  }

  // Changer le type d'une relation la retire aux cumuls de la même manière.
  function changeTypeOf(prop: Property, type: PropertyType) {
    const changed = changeTypeTo(prop, type);
    const next = properties.map((item) => (item.id === prop.id ? changed : item));
    if (prop.type === "relation" && type !== "relation") {
      return next.filter((item) => item.type !== "rollup" || item.relation !== prop.id);
    }
    return next;
  }

  // Passer une propriété en relation demande sa base cible : la première de
  // l'arbre à défaut, que l'on change juste en dessous.
  function changeTypeTo(prop: Property, type: PropertyType): Property {
    const next = changeType(prop, type, valuesList);
    if (type === "relation") {
      next.target = prop.target ?? databases[0]?.id ?? "";
      next.single = prop.single ?? false;
      next.reciprocal = prop.reciprocal ?? false;
    }
    // Un cumul part d'une relation de la base, quand il y en a une ; la
    // propriété visée se choisit ensuite, une fois la base cible lue.
    if (type === "rollup") {
      const first = properties.find((item) => item.type === "relation" && !isTwin(item));
      next.relation = prop.relation ?? first?.id;
      // La propriété visée n'a rien à voir avec la base cible d'une relation :
      // on repart d'un choix vierge.
      next.target = undefined;
      next.calc = prop.calc ?? "count";
    }
    return next;
  }

  return (
    <section className="schema" aria-label="Propriétés de la base">
      {properties.length === 0 && <p className="hint">Aucune propriété. Ajoutez-en une pour décrire les entrées : tags, avancement, date, lien…</p>}
      {properties.map((prop) => (
        <div className="schema-prop" key={prop.id}>
          <div className="schema-head">
            {isTwin(prop) ? (
              <>
                {/* La jumelle appartient à l'autre base : son nom, son type et
                    sa cible suivent la relation déclarante et ne se règlent pas
                    ici. La supprimer retire la réciprocité à la déclarante. */}
                <span className="schema-name schema-twin" title="Jumelle d'une relation déclarée dans une autre base">
                  ↩ {prop.name}
                </span>
                <span className="hint schema-hint">Suit la relation d&apos;origine</span>
              </>
            ) : (
              <>
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
                  onChange={(event) => onChange(changeTypeOf(prop, event.target.value as PropertyType))}
                >
                  {PROPERTY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                {prop.type === "number" && (
                  <select
                    aria-label={`Format de ${prop.name}`}
                    value={prop.format ?? "number"}
                    onChange={(event) => update(prop.id, (p) => ({ ...p, format: event.target.value as NumberFormat }))}
                  >
                    {NUMBER_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                )}
                {prop.type === "rollup" && (
                  <RollupEditor
                    prop={prop}
                    properties={properties}
                    onChange={(patch) => update(prop.id, (p) => ({ ...p, ...patch }))}
                  />
                )}
                {prop.type === "relation" && (
                  <>
                    <select
                      aria-label={`Base cible de ${prop.name}`}
                      value={prop.target ?? ""}
                      onChange={(event) => update(prop.id, (p) => ({ ...p, target: event.target.value }))}
                    >
                      {databases.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.title || "Sans titre"}
                        </option>
                      ))}
                    </select>
                    <label className="schema-check">
                      <input
                        type="checkbox"
                        checked={prop.single === true}
                        onChange={(event) => update(prop.id, (p) => ({ ...p, single: event.target.checked }))}
                      />
                      Une seule entrée
                    </label>
                    <label className="schema-check">
                      <input
                        type="checkbox"
                        checked={prop.reciprocal === true}
                        onChange={(event) => update(prop.id, (p) => ({ ...p, reciprocal: event.target.checked }))}
                      />
                      Réciproque
                    </label>
                  </>
                )}
              </>
            )}
            <button type="button" className="ghost" onClick={() => removeProperty(prop.id)}>
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
    <>
      {/* Une propriété n'est pas une colonne du Kanban : ce sont ses options. */}
      {isSingleOptionType(prop.type) && <p className="hint schema-hint">Chaque option est une valeur possible, et une colonne du Kanban.</p>}
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
              onChange([...options, { id: localId("opt"), name, color: nextColor(options) }]);
            }}
          />
        </li>
      </ul>
    </>
  );
}
