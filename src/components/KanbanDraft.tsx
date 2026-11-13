"use client";
// Carte-brouillon d'une colonne Kanban : le « + » l'ouvre en bas de colonne,
// là où l'entrée sera rangée, et le titre s'écrit directement, sans passer par
// la page. Entrée ou perte du focus crée l'entrée (un titre vide ferme sans
// rien créer), Échap annule. Si la création échoue, le brouillon reste ouvert
// avec son texte.
import { useRef, useState } from "react";

type Props = {
  onSubmit: (title: string) => Promise<boolean>;
  onClose: () => void;
};

export function KanbanDraft({ onSubmit, onClose }: Props) {
  const [title, setTitle] = useState("");
  // Entrée déclenche une création puis un blur : une seule des deux doit partir.
  const settled = useRef(false);

  async function commit() {
    if (settled.current) return;
    const next = title.trim();
    settled.current = true;
    if (!next) {
      onClose();
      return;
    }
    const ok = await onSubmit(next);
    if (ok) onClose();
    else settled.current = false;
  }

  function cancel() {
    settled.current = true;
    onClose();
  }

  return (
    <div className="board-card board-card-draft">
      <div className="board-card-head">
        <textarea
          ref={(element) => {
            // Au montage seulement : le brouillon prend le focus et se place
            // dans la zone visible de la colonne.
            if (element && document.activeElement !== element) {
              element.focus();
              element.scrollIntoView({ block: "nearest" });
            }
          }}
          className="board-card-input"
          rows={1}
          value={title}
          placeholder="Titre de l'entrée"
          aria-label="Titre de la nouvelle entrée"
          onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, " "))}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      </div>
    </div>
  );
}
