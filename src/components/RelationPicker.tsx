"use client";
// Choix des entrées d'une relation : on cherche dans la base cible, on clique,
// ou l'on crée l'entrée à la volée (« Créer … »), qui naît dans cette base et
// se lie dans le même geste (BRAINSTORMING §13). Les entrées de la base cible
// sont lues à l'ouverture du menu par GET /api/databases/[id], la seule route
// qui rende une base arbitraire avec ses entrées.
// Le menu est monté dans <body> et positionné en fixe, comme celui des options,
// pour n'être rogné ni par la cellule ni par le conteneur qui défile.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fold, type LinkRef, type Property } from "@/lib/properties";
import { PageIcon } from "./PageIcon";

type Props = {
  prop: Property;
  selected: string[];
  // Puces déjà résolues par le serveur, pour l'état fermé.
  links?: readonly LinkRef[];
  onChange: (ids: string[]) => void;
  // Crée l'entrée dans la base cible ; renvoie son id, ou null en cas d'échec.
  onCreateEntry: (title: string) => Promise<string | null>;
};

type MenuPosition = { left: number; top: number; width: number; above: boolean };
type Candidate = { id: string; title: string; icon: string | null };

const MIN_MENU_WIDTH = 224;
const VIEWPORT_MARGIN = 12;

export function RelationPicker({ prop, selected, links = [], onChange, onCreateEntry }: Props) {
  const multiple = prop.single !== true;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  // Entrées choisies ou créées dans ce menu : le serveur ne les connaît pas
  // encore quand la puce s'affiche, faute d'un rafraîchissement terminé. Une
  // fois relu, `links` les remplace par leur vraie ligne.
  const [picked, setPicked] = useState<LinkRef[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const known = new Map<string, LinkRef>();
  for (const ref of picked) known.set(ref.id, ref);
  for (const ref of links) known.set(ref.id, ref);

  function remember(ref: LinkRef) {
    setPicked((current) => (current.some((item) => item.id === ref.id) ? current : [...current, ref]));
  }

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
    setError(null);
    setOpen(true);
  }

  // Les entrées de la base cible, lues à l'ouverture. Une base peut être
  // grande : la recherche filtre ensuite dans le navigateur.
  useEffect(() => {
    if (!open || candidates !== null) return;
    let alive = true;
    void fetch(`/api/databases/${prop.target}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Cette base est introuvable.");
        const data = (await response.json()) as { entries?: Candidate[] };
        if (alive) setCandidates((data.entries ?? []).map(({ id, title, icon }) => ({ id, title, icon })));
      })
      .catch((problem: unknown) => {
        if (alive) setError(problem instanceof Error ? problem.message : "Cette base est introuvable.");
      });
    return () => {
      alive = false;
    };
  }, [open, candidates, prop.target]);

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

  const typed = query.trim();
  const pool = (candidates ?? []).filter((entry) => !selected.includes(entry.id));
  const matches = pool.filter((entry) => fold(entry.title).includes(fold(typed)));
  const exact = (candidates ?? []).find((entry) => fold(entry.title) === fold(typed) && !selected.includes(entry.id));

  function pick(id: string) {
    setQuery("");
    if (!selected.includes(id)) {
      const found = candidates?.find((entry) => entry.id === id);
      if (found) remember({ id, title: found.title, icon: found.icon, trashed: false, publicBaseId: null });
    }
    if (!multiple) {
      onChange(selected[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  async function create() {
    if (!typed || exact || busy) return;
    setBusy(true);
    const id = await onCreateEntry(typed);
    setBusy(false);
    if (!id) {
      setError("L'entrée n'a pas pu être créée.");
      return;
    }
    remember({ id, title: typed, icon: null, trashed: false, publicBaseId: null });
    setQuery("");
    onChange(multiple ? [...selected, id] : [id]);
    if (!multiple) setOpen(false);
    else setCandidates((current) => (current ? [...current, { id, title: typed, icon: null }] : current));
  }

  const chosen = selected.flatMap((id) => {
    const ref = known.get(id);
    return ref && !ref.trashed ? [ref] : [];
  });

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
            {chosen.map((ref) => (
              <span key={ref.id} className="chip chip-link">
                <PageIcon icon={ref.icon} type="entry" /> {ref.title || "Sans titre"}
              </span>
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
            onClick={(event) => event.stopPropagation()}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
            {multiple && chosen.length > 0 && (
              <ul className="picker-chosen" aria-label={`${prop.name} : entrées liées`}>
                {chosen.map((ref) => (
                  <li key={ref.id}>
                    <span className="chip chip-link">
                      <PageIcon icon={ref.icon} type="entry" /> {ref.title || "Sans titre"}
                    </span>
                    <button type="button" className="chip-remove" aria-label={`Retirer ${ref.title || "cette entrée"}`} onClick={() => pick(ref.id)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              autoFocus
              aria-label={`Chercher ou créer une entrée pour ${prop.name}`}
              placeholder="Chercher ou créer une entrée"
              value={query}
              maxLength={500}
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
            {error && <p className="status status-error">{error}</p>}
            {candidates === null && !error && <p className="hint picker-hint">Chargement…</p>}
            <ul>
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="picker-option" onClick={() => pick(entry.id)}>
                    <PageIcon icon={entry.icon} type="entry" /> {entry.title || "Sans titre"}
                  </button>
                </li>
              ))}
              {typed && !exact && (
                <li>
                  <button type="button" className="picker-option" disabled={busy} onClick={() => void create()}>
                    Créer « {typed} »
                  </button>
                </li>
              )}
              {!typed && candidates !== null && matches.length === 0 && (
                <li className="hint picker-hint">Cette base est vide ; tapez un titre pour créer sa première entrée.</li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
