"use client";
// Vue Tableau : une ligne par entrée, une colonne par propriété affichée (la
// vue peut en masquer), le titre en tête. Chaque cellule porte l'éditeur de son type : la valeur se règle là,
// sans ouvrir l'entrée. Cliquer ailleurs sur la ligne ouvre l'entrée. En pied
// de colonne, un calcul propre à la vue, sur les entrées qu'elle montre.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TITLE_PROP, type EntryRow, type Property, type Value } from "@/lib/properties";
import { CALC_LABELS, calcOpsFor, calcText, computeCalc, type CalcOp } from "@/lib/views";
import { PageLabel } from "./PageIcon";
import { PropertyInput } from "./PropertyInput";
import { TYPE_ICONS } from "./propertyUi";

type Props = {
  properties: Property[];
  entries: EntryRow[];
  filtered: boolean;
  onCreate: () => void;
  onSave: (entryId: string, propId: string, value: Value | null) => void;
  onCreateOption: (prop: Property, name: string) => Promise<string | null>;
  calcs: Record<string, CalcOp>;
  onCalc: (propId: string, op: CalcOp | null) => void;
};

// Un clic sur un élément de saisie ne doit pas ouvrir l'entrée.
const INTERACTIVE = "a, button, input, select, textarea, label, .picker";

export function TableView({ properties, entries, filtered, onCreate, onSave, onCreateOption, calcs, onCalc }: Props) {
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
                if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
                router.push(`/page/${entry.id}`);
              }}
            >
              <td className="cell-title">
                <Link href={`/page/${entry.id}`}><PageLabel row={entry} /></Link>
              </td>
              {properties.map((prop) => (
                <td key={prop.id} className="cell-edit">
                  <PropertyInput
                    prop={prop}
                    value={entry.values[prop.id]}
                    onSave={(value) => onSave(entry.id, prop.id, value)}
                    onCreate={(name) => onCreateOption(prop, name)}
                  />
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
        <tfoot>
          <tr>
            {[TITLE_PROP, ...properties].map((prop) => (
              <td key={prop.id}>
                <CalcCell prop={prop} op={calcs[prop.id]} entries={entries} onChange={(op) => onCalc(prop.id, op)} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <button type="button" className="ghost add-entry" onClick={onCreate}>
        + Nouvelle entrée
      </button>
    </div>
  );
}

// Le résultat s'affiche ; le <select> natif, transparent par-dessus, ouvre la
// liste des calculs (roue du système sur téléphone).
function CalcCell({ prop, op, entries, onChange }: { prop: Property; op: CalcOp | undefined; entries: EntryRow[]; onChange: (op: CalcOp | null) => void }) {
  return (
    <label className={op ? "calc-cell calc-set" : "calc-cell"}>
      <span aria-hidden="true">{op ? calcText(prop, op, computeCalc(entries, prop, op)) : "Calculer"}</span>
      <select aria-label={`Calcul de ${prop.name}`} value={op ?? ""} onChange={(event) => onChange((event.target.value || null) as CalcOp | null)}>
        <option value="">Aucun</option>
        {calcOpsFor(prop).map((item) => (
          <option key={item} value={item}>
            {CALC_LABELS[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
