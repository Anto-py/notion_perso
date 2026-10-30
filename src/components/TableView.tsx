"use client";
// Vue Tableau : une ligne par entrée, une colonne par propriété, le titre en
// tête. Cliquer une ligne ouvre l'entrée ; un lien dans une cellule (Source)
// s'ouvre lui-même, sans ouvrir l'entrée.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EntryRow, Property } from "@/lib/properties";
import { label } from "@/lib/tree";
import { TYPE_ICONS, ValueView } from "./propertyUi";

type Props = { properties: Property[]; entries: EntryRow[]; filtered: boolean; onCreate: () => void };

export function TableView({ properties, entries, filtered, onCreate }: Props) {
  const router = useRouter();
  return (
    <div className="table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="prop-icon" aria-hidden="true">
                Aa
              </span>
              Titre
            </th>
            {properties.map((prop) => (
              <th scope="col" key={prop.id}>
                <span className="prop-icon" aria-hidden="true">
                  {TYPE_ICONS[prop.type]}
                </span>
                {prop.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) return;
                router.push(`/page/${entry.id}`);
              }}
            >
              <td className="cell-title">
                <Link href={`/page/${entry.id}`}>{label(entry)}</Link>
              </td>
              {properties.map((prop) => (
                <td key={prop.id}>
                  <ValueView prop={prop} value={entry.values[prop.id]} />
                </td>
              ))}
            </tr>
          ))}
          {entries.length === 0 && filtered && (
            <tr>
              <td colSpan={properties.length + 1} className="hint">
                Aucune entrée ne correspond aux filtres.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <button type="button" className="ghost add-entry" onClick={onCreate}>
        + Nouvelle entrée
      </button>
    </div>
  );
}
