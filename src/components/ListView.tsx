"use client";
// Vue Liste, pensée pour le téléphone : une ligne par entrée, icône et titre
// à gauche, valeurs des propriétés affichées à droite, en petit (sous le titre
// sur écran étroit). Lecture seule : la saisie se fait dans l'entrée. Pas de
// glisser-déposer, l'ordre est celui des tris de la vue, à défaut l'ordre manuel.
import Link from "next/link";
import { normalizeValue, type EntryRow, type Property } from "@/lib/properties";
import { PageLabel } from "./PageIcon";
import { ValueView } from "./propertyUi";

type Props = { properties: Property[]; entries: EntryRow[]; filtered: boolean; onCreate: () => void };

export function ListView({ properties, entries, filtered, onCreate }: Props) {
  return (
    <div className="list-view">
      <ul>
        {entries.map((entry) => {
          // Une valeur vide ne prend pas de place ; une case non cochée non plus.
          const fields = properties.filter((prop) => {
            const value = normalizeValue(prop, entry.values[prop.id]);
            return value !== undefined && (prop.type !== "checkbox" || value === true);
          });
          return (
            <li key={entry.id}>
              <Link href={`/page/${entry.id}`} className="list-row">
                <span className="list-title">
                  <PageLabel row={entry} />
                </span>
                {fields.length > 0 && (
                  <span className="list-fields">
                    {fields.map((prop) => (
                      <span className="list-field" key={prop.id} title={prop.name}>
                        {prop.type === "checkbox" && <span className="list-field-name">{prop.name}</span>}
                        <ValueView prop={prop} value={entry.values[prop.id]} linked={false} />
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && filtered && <p className="hint">Aucune entrée ne correspond aux filtres.</p>}
      <button type="button" className="ghost add-entry" onClick={onCreate}>
        + Nouvelle entrée
      </button>
    </div>
  );
}
