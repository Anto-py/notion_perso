"use client";
// Éditeur d'une valeur de propriété, selon son type. Partagé par le panneau
// d'une entrée et par les cellules du tableau : une seule façon de saisir.
import { useState } from "react";
import { formatNumber, parseNumber, type LinkRef, type Property, type Value } from "@/lib/properties";
import { CommitInput } from "./CommitInput";
import { CommitTextarea } from "./CommitTextarea";
import { OptionPicker } from "./OptionPicker";
import { RelationPicker } from "./RelationPicker";
import { isWebUrl, ValueView } from "./propertyUi";

export type PropertyInputProps = {
  prop: Property;
  value: Value | undefined;
  onSave: (value: Value | null) => void;
  // Crée l'option dans la base ; renvoie son id, ou null en cas d'échec.
  onCreate: (name: string) => Promise<string | null>;
  // Crée l'entrée dans la base cible d'une relation ; renvoie son id, ou null.
  onCreateEntry: (prop: Property, title: string) => Promise<string | null>;
  // Puces déjà résolues (relation) : titre et icône des entrées citées.
  links?: readonly LinkRef[];
  // Texte et lien : focus dès l'affichage (encadré d'une cellule de tableau).
  focusAtEnd?: boolean;
};

export function PropertyInput({ prop, value, onSave, onCreate, onCreateEntry, links, focusAtEnd }: PropertyInputProps) {
  const text = typeof value === "string" ? value : "";
  switch (prop.type) {
    case "text":
      return (
        <CommitTextarea
          className="prop-input"
          aria-label={prop.name}
          placeholder="Vide"
          value={text}
          maxLength={5000}
          focusAtEnd={focusAtEnd}
          onCommit={(next) => onSave(next || null)}
        />
      );
    case "url":
      return (
        <span className="prop-url">
          <CommitTextarea
            className="prop-input"
            aria-label={prop.name}
            placeholder="https://…"
            inputMode="url"
            value={text}
            maxLength={2048}
            multiline={false}
            focusAtEnd={focusAtEnd}
            onCommit={(next) => onSave(next || null)}
          />
          {isWebUrl(text) && (
            <a href={text} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${prop.name}`}>
              ↗
            </a>
          )}
        </span>
      );
    case "number":
      return <NumberInput prop={prop} value={typeof value === "number" ? value : undefined} onSave={onSave} />;
    case "created_time":
    case "updated_time":
      // Lecture seule : tirée de la vie de l'entrée, jamais saisie.
      return <ValueView prop={prop} value={value} />;
    // Calculé à la lecture, jamais saisi.
    case "rollup":
      return <ValueView prop={prop} value={value} />;
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
    case "relation":
      return (
        <RelationPicker
          prop={prop}
          selected={Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []}
          links={links}
          onChange={(ids) => onSave(ids.length > 0 ? ids : null)}
          onCreateEntry={(title) => onCreateEntry(prop, title)}
        />
      );
  }
}

// Nombre saisi avec virgule ou point, affiché à la française dans son format.
// Une saisie illisible est refusée sur place : le champ, recréé, reprend la
// valeur enregistrée.
function NumberInput({ prop, value, onSave }: { prop: Property; value: number | undefined; onSave: (value: Value | null) => void }) {
  const [refusals, setRefusals] = useState(0);
  const shown = value === undefined ? "" : formatNumber(value, prop.format);
  return (
    <CommitInput
      key={`${shown}|${refusals}`}
      className="number-input"
      aria-label={prop.name}
      placeholder="Vide"
      inputMode="decimal"
      value={shown}
      maxLength={40}
      onCommit={(typed) => {
        if (typed === "") return onSave(null);
        const parsed = parseNumber(typed);
        if (parsed === null) setRefusals((n) => n + 1);
        else if (parsed !== value) onSave(parsed);
      }}
    />
  );
}
