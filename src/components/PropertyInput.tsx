"use client";
// Éditeur d'une valeur de propriété, selon son type. Partagé par le panneau
// d'une entrée et par les cellules du tableau : une seule façon de saisir.
import type { Property, Value } from "@/lib/properties";
import { CommitInput } from "./CommitInput";
import { OptionPicker } from "./OptionPicker";
import { isWebUrl } from "./propertyUi";

export type PropertyInputProps = {
  prop: Property;
  value: Value | undefined;
  onSave: (value: Value | null) => void;
  // Crée l'option dans la base ; renvoie son id, ou null en cas d'échec.
  onCreate: (name: string) => Promise<string | null>;
};

export function PropertyInput({ prop, value, onSave, onCreate }: PropertyInputProps) {
  const text = typeof value === "string" ? value : "";
  switch (prop.type) {
    case "text":
      return <CommitInput aria-label={prop.name} placeholder="Vide" value={text} maxLength={5000} onCommit={(next) => onSave(next || null)} />;
    case "url":
      return (
        <span className="prop-url">
          <CommitInput aria-label={prop.name} placeholder="https://…" inputMode="url" value={text} maxLength={2048} onCommit={(next) => onSave(next || null)} />
          {isWebUrl(text) && (
            <a href={text} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${prop.name}`}>
              ↗
            </a>
          )}
        </span>
      );
    case "date":
      return <input type="date" aria-label={prop.name} value={text} onChange={(event) => onSave(event.target.value || null)} />;
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
