"use client";
// Bandeau de la page et son sélecteur (BRAINSTORMING §1 ter) : couleur de la
// palette ou image téléversée, recadrage vertical au glisser ou au clavier.
// L'image appartient à la page (média), la couleur à la charte (lib/covers.ts).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { checkIconUpload, ICON_TYPES } from "@/lib/icons";
import { checkCoverPosition, colorCover, COVER_COLORS, coverPosition, parseCover } from "@/lib/covers";
import { PageCover } from "./PageCover";
import { send } from "./request";

type Props = { pageId: string; initial: string | null; initialPosition: number | null };

type Drag = { startY: number; startPos: number; height: number; currentPos: number; moved: boolean };

export function CoverPicker({ pageId, initial, initialPosition }: Props) {
  const router = useRouter();
  const [cover, setCover] = useState(initial);
  const [position, setPosition] = useState(coverPosition(initialPosition));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  // Position vraie, avancée à chaque geste : deux frappes plus rapides qu'un
  // rendu doivent s'enchaîner, pas repartir de la même valeur.
  const positionRef = useRef(position);

  function moveTo(next: number) {
    positionRef.current = next;
    setPosition(next);
  }

  // Fermeture au clic hors de la zone ou sur Échap.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!zoneRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(next: string | null) {
    const previous = { cover, position };
    setCover(next);
    moveTo(50);
    setOpen(false);
    setError(null);
    const result = await send(`/api/pages/${pageId}`, "PATCH", { cover: next });
    if (!result.ok) {
      setCover(previous.cover);
      moveTo(previous.position);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const check = checkIconUpload(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/pages/${pageId}/cover`, { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    const data = (await response?.json().catch(() => null)) as { cover?: string; position?: number; error?: string } | null;
    if (!response?.ok || !data?.cover) {
      setError(data?.error ?? "Envoi impossible : réessayez.");
      return;
    }
    setCover(data.cover);
    moveTo(coverPosition(data.position));
    setOpen(false);
    router.refresh();
  }

  // Le cadrage n'est écrit qu'au relâchement : un geste, une requête.
  async function savePosition(next: number, previous: number) {
    const result = await send(`/api/pages/${pageId}`, "PATCH", { coverPosition: next });
    if (!result.ok) {
      moveTo(previous);
      setError(result.error);
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>, mouseOnly: boolean) {
    if (mouseOnly && event.pointerType !== "mouse") return;
    // Référence : la hauteur du bandeau entier, pas celle de la poignée qu'on
    // saisit. Le geste se mesure sur ce que l'image peut parcourir.
    const surface = event.currentTarget.closest(".cover-surface") ?? event.currentTarget;
    const height = surface.getBoundingClientRect().height;
    if (!height) return;
    // La capture garde le suivi quand le pointeur sort du bandeau ; un pointeur
    // déjà relâché la refuse, sans conséquence.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointeur absent (tactile interrompu) */
    }
    const start = positionRef.current;
    dragRef.current = { startY: event.clientY, startPos: start, height, currentPos: start, moved: false };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // Glisser vers le bas découvre le haut de l'image : la position baisse.
    const next = coverPosition(drag.startPos - ((event.clientY - drag.startY) / drag.height) * 100);
    if (next === drag.startPos) return;
    drag.currentPos = next;
    drag.moved = true;
    moveTo(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* aucune capture à relâcher */
    }
    void savePosition(drag.currentPos, drag.startPos);
  }

  function keyPosition(event: ReactKeyboardEvent) {
    const current = positionRef.current;
    const step = event.shiftKey ? 10 : 2;
    let next: number | null = null;
    if (event.key === "ArrowUp") next = current + step;
    if (event.key === "ArrowDown") next = current - step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = 100;
    const bounded = next === null ? null : checkCoverPosition(next);
    if (bounded === null) return;
    event.preventDefault();
    moveTo(bounded);
    void savePosition(bounded, current);
  }

  const parsed = parseCover(cover);
  const hasImage = parsed?.kind === "image";

  return (
    <div className={cover ? "cover-zone" : "cover-zone cover-zone-empty"} ref={zoneRef}>
      {cover ? (
        <div
          className="cover-surface"
          onPointerDown={(event) => startDrag(event, true)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <PageCover cover={cover} position={position} />
          {hasImage && (
            <div
              className="cover-handle"
              role="slider"
              tabIndex={0}
              aria-label="Cadrage vertical du bandeau"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={position}
              aria-valuetext={`${position} %`}
              onPointerDown={(event) => {
                // Sans cela, le pointeur remonte à la surface et démarre un
                // second suivi sur le même geste.
                event.stopPropagation();
                startDrag(event, false);
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={keyPosition}
            >
              <span aria-hidden="true">⠿ Glisser pour recadrer ({position} %)</span>
            </div>
          )}
          <div className="cover-tools" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="ghost" onClick={() => setOpen(!open)}>
              Changer le bandeau
            </button>
            <button type="button" className="ghost" onClick={() => choose(null)}>
              Retirer
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost cover-add" onClick={() => setOpen(!open)}>
          ▭ Ajouter un bandeau
        </button>
      )}
      {error && (
        <span className="status status-error" role="alert">
          {error}
        </span>
      )}
      {open && <CoverPanel busy={busy} onPick={choose} onUpload={upload} />}
    </div>
  );
}

function CoverPanel({
  busy,
  onPick,
  onUpload,
}: {
  busy: boolean;
  onPick: (cover: string) => void;
  onUpload: (file: File | undefined) => void;
}) {
  const [tab, setTab] = useState<"color" | "image">("color");
  return (
    <div className="cover-panel" role="dialog" aria-label="Choisir un bandeau">
      <div className="icon-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "color"} onClick={() => setTab("color")}>
          Couleur
        </button>
        <button type="button" role="tab" aria-selected={tab === "image"} onClick={() => setTab("image")}>
          Image
        </button>
      </div>
      {tab === "color" ? (
        <div className="cover-swatches">
          {COVER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`cover-swatch cover-${color}`}
              aria-label={`Bandeau ${color}`}
              onClick={() => onPick(colorCover(color))}
            />
          ))}
        </div>
      ) : (
        <label className="icon-drop">
          {busy ? "Envoi…" : "Choisir une image"}
          <span className="hint">PNG, JPEG, GIF, WebP ou AVIF, 5 Mo au plus</span>
          <input
            type="file"
            accept={Object.keys(ICON_TYPES).join(",")}
            className="icon-file-input"
            disabled={busy}
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
        </label>
      )}
    </div>
  );
}
