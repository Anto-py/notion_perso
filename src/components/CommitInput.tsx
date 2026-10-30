"use client";
// Champ qui n'enregistre qu'en le quittant (perte du focus ou Entrée) et
// seulement s'il a changé ; Échap rend la valeur d'origine. allowEmpty faux :
// un champ vidé reprend sa valeur (un nom ne peut pas être vide).
// Le parent le recrée (key) quand la valeur enregistrée change ailleurs.
import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
  allowEmpty?: boolean;
};

export function CommitInput({ value, onCommit, allowEmpty = true, ...rest }: Props) {
  const [draft, setDraft] = useState(value);

  // La valeur est lue dans le champ, pas dans draft : un rendu en retard sur
  // la frappe (saisie puis Entrée dans la même tâche) n'enregistre jamais
  // l'avant-dernière version.
  function commit(typed: string) {
    const next = typed.trim();
    if (!next && !allowEmpty) {
      setDraft(value);
      return;
    }
    if (next !== value.trim()) onCommit(next);
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          // Perte du focus après le rendu : le champ montre alors la valeur
          // d'origine, et commit n'enregistre rien.
          const input = event.currentTarget;
          setTimeout(() => input.blur());
        }
      }}
    />
  );
}
