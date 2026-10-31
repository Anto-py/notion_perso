"use client";
// Pendant de CommitInput pour un texte qui doit se lire en entier : la zone
// grandit avec son contenu, le texte passe à la ligne. Enregistre en la
// quittant (perte du focus ou Entrée) et seulement si le texte a changé ;
// Échap rend la valeur d'origine. multiline : Maj + Entrée insère un saut de
// ligne ; sinon (un lien), aucun saut de ligne n'entre, même collé.
// Un <input> retirerait en silence les sauts de ligne d'une valeur : il
// suffirait d'y entrer puis d'en sortir pour l'enregistrer aplatie.
import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  // Focus à l'ouverture, curseur après le dernier caractère.
  focusAtEnd?: boolean;
};

export function CommitTextarea({ value, onCommit, multiline = true, focusAtEnd = false, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = area.current;
    if (!focusAtEnd || !node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [focusAtEnd]);

  // Hauteur au contenu : remise à zéro puis hauteur de défilement, à chaque
  // frappe comme à l'ouverture. scrollHeight ignore la bordure, que
  // offsetHeight - clientHeight rajoute.
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [draft]);

  // Lu dans la zone, pas dans draft (même raison que CommitInput).
  function commit(typed: string) {
    const next = typed.trim();
    if (next !== value.trim()) onCommit(next);
  }

  return (
    <textarea
      {...rest}
      ref={area}
      rows={1}
      value={draft}
      onChange={(event) => setDraft(multiline ? event.target.value : event.target.value.replace(/[\r\n]+/g, " "))}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !(multiline && event.shiftKey)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          const node = event.currentTarget;
          setTimeout(() => node.blur());
        }
      }}
    />
  );
}
