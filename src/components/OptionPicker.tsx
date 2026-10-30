"use client";
// Choix d'options d'une sélection (simple ou multiple), avec
// création à la volée : taper un nom absent propose « Créer … ». Entrée
// choisit l'option exacte, sinon la première trouvée, sinon crée.
// Le menu est monté dans <body> et positionné en fixe : dans une cellule de
// tableau, il ne doit être rogné ni par la cellule ni par le conteneur qui
// fait défiler horizontalement.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type MenuPosition = { left: number; top: number; width: number; above: boolean };

const MIN_MENU_WIDTH = 224;
const VIEWPORT_MARGIN = 12;

export function OptionPicker({ prop, selected, multiple, onChange, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Le menu suit l'ordre des options, le même que les colonnes du Kanban.
  const options = prop.options ?? [];
  const typed = query.trim();
  const matches = options.filter((option) => fold(option.name).includes(fold(typed)));
  const exact = options.find((option) => fold(option.name) === fold(typed));

  function showMenu() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, MIN_MENU_WIDTH), window.innerWidth - 2 * VIEWPORT_MARGIN);
    setPosition({
      left: Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
      top: rect.bottom + 4,
      width,
      above: rect.bottom > window.innerHeight * 0.6,
    });
    setQuery("");
    setOpen(true);
  }

  // Un clic hors du bouton et du menu le ferme ; un défilement le referme
  // plutôt que de le laisser flotter à côté de sa cellule.
  useEffect(() => {
    if (!open) return;
    const closeOut = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", closeOut);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOut);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
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
    <div className="picker">
      <button
        ref={trigger}
        type="button"
        className="picker-value"
        aria-expanded={open}
        aria-label={`${prop.name} : modifier`}
        onClick={() => (open ? setOpen(false) : showMenu())}
      >
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
      {open &&
        position &&
        createPortal(
          <div
            ref={menu}
            className="picker-menu picker-menu-fixed"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
