"use client";
// Choix d'options d'une sélection (simple ou multiple), avec création à la
// volée : taper un nom absent propose « Créer … ». Entrée choisit l'option
// exacte, sinon la première trouvée, sinon crée.
import { useEffect, useRef, useState } from "react";
import { fold, nextColor, optionById, type Property } from "@/lib/properties";
import { OptionChip } from "./propertyUi";

type Props = {
  prop: Property;
  selected: string[];
  multiple: boolean;
  onChange: (ids: string[]) => void;
  // Crée l'option dans la base ; renvoie son id, ou null en cas d'échec.
  onCreate: (name: string) => Promise<string | null>;
};

export function OptionPicker({ prop, selected, multiple, onChange, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const options = prop.options ?? [];
  const typed = query.trim();
  const matches = options.filter((option) => fold(option.name).includes(fold(typed)));
  const exact = options.find((option) => fold(option.name) === fold(typed));

  // Un clic hors du menu le ferme.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function pick(id: string) {
    setQuery("");
    if (multiple) {
      onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    } else {
      onChange(selected[0] === id ? [] : [id]);
      setOpen(false);
    }
  }

  async function create() {
    if (!typed || exact || busy) return;
    setBusy(true);
    const id = await onCreate(typed);
    setBusy(false);
    if (!id) return;
    setQuery("");
    onChange(multiple ? [...selected, id] : [id]);
    if (!multiple) setOpen(false);
  }

  const chosen = selected.map((id) => optionById(prop, id)).filter((option) => option !== undefined);

  return (
    <div className="picker" ref={root}>
      <button type="button" className="picker-value" aria-expanded={open} aria-label={`${prop.name} : modifier`} onClick={() => setOpen(!open)}>
        {chosen.length > 0 ? (
          <span className="chips">
            {chosen.map((option) => (
              <OptionChip key={option.id} option={option} />
            ))}
          </span>
        ) : (
          <span className="empty-value">Vide</span>
        )}
      </button>
      {open && (
        <div className="picker-menu">
          <input
            // Le menu s'ouvre pour taper : le curseur y va directement.
            autoFocus
            aria-label={`Chercher ou créer une option de ${prop.name}`}
            placeholder="Chercher ou créer une option"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key !== "Enter") return;
              event.preventDefault();
              const target = exact ?? (typed ? matches[0] : undefined);
              if (target) pick(target.id);
              else void create();
            }}
          />
          <ul>
            {matches.map((option) => (
              <li key={option.id}>
                <button type="button" className="picker-option" aria-pressed={selected.includes(option.id)} onClick={() => pick(option.id)}>
                  <OptionChip option={option} />
                  {selected.includes(option.id) && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
            {typed && !exact && (
              <li>
                <button type="button" className="picker-option" disabled={busy} onClick={() => void create()}>
                  Créer <OptionChip option={{ name: typed, color: nextColor(options) }} />
                </button>
              </li>
            )}
            {!typed && options.length === 0 && <li className="hint picker-hint">Tapez un nom pour créer la première option.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
