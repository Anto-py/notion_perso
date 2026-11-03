"use client";
// Choix de la cible d'un « Lien vers une page » (BRAINSTORMING §2) : un champ
// de recherche et la liste des pages et bases de l'arbre, chemin compris pour
// départager deux homonymes (linkChoices). Le menu est monté dans <body> en
// position fixe sous le bloc, comme celui d'une relation : ProseMirror n'en
// voit ni les frappes ni les flèches. Échap ou un clic hors du menu abandonne.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { linkChoices, type TreeRow } from "@/lib/tree";
import { PageLabel } from "./PageIcon";

type Props = {
  anchor: HTMLElement;
  pages: ReadonlyMap<string, TreeRow>;
  hostId: string;
  onPick: (row: TreeRow) => void;
  onCancel: () => void;
};

// Au-delà, la liste demande de préciser la recherche plutôt que de tout peindre.
const SHOWN_MAX = 50;
const MENU_WIDTH = 420;
const VIEWPORT_MARGIN = 12;

export function PagePicker({ anchor, pages, hostId, onPick, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Le menu suit le bloc quand la page défile, au lieu de flotter à côté.
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const choices = linkChoices([...pages.values()], hostId, query);
  const shown = choices.slice(0, SHOWN_MAX);

  useEffect(() => {
    const follow = () => setRect(anchor.getBoundingClientRect());
    const closeOut = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onCancel();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    document.addEventListener("pointerdown", closeOut);
    // Le menu « / » rend le focus à l'éditeur en se fermant : le champ le
    // reprend juste après.
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("pointerdown", closeOut);
      clearTimeout(focus);
    };
  }, [anchor, onCancel]);

  const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
  const above = rect.bottom > window.innerHeight * 0.6;
  const style = {
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
    top: above ? rect.top - 4 : rect.bottom + 4,
    width,
    transform: above ? "translateY(-100%)" : undefined,
  };

  return createPortal(
    <div ref={menu} className="picker-menu picker-menu-fixed page-picker" style={style}>
      <input
        ref={input}
        aria-label="Chercher la page à lier"
        placeholder="Chercher une page ou une base"
        value={query}
        maxLength={500}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => (shown.length ? (current + step + shown.length) % shown.length : 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const choice = shown[active];
            if (choice) onPick(choice.row);
          }
        }}
      />
      <ul role="listbox" aria-label="Pages et bases">
        {shown.map((choice, index) => (
          <li key={choice.row.id} role="option" aria-selected={index === active}>
            <button
              type="button"
              className={`picker-option page-picker-option${index === active ? " is-active" : ""}`}
              onClick={() => onPick(choice.row)}
              onPointerEnter={() => setActive(index)}
            >
              <span className="page-picker-title">
                <PageLabel row={choice.row} />
              </span>
              {choice.path.length > 0 && <span className="page-picker-path">{choice.path.join(" / ")}</span>}
            </button>
          </li>
        ))}
        {choices.length > SHOWN_MAX && (
          <li className="hint picker-hint">{choices.length - SHOWN_MAX} autres : précisez la recherche.</li>
        )}
        {choices.length === 0 && <li className="hint picker-hint">Aucune page ne porte ce titre.</li>}
      </ul>
    </div>,
    document.body,
  );
}
