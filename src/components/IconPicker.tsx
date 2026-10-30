"use client";
// Icône au-dessus du titre et panneau de choix (BRAINSTORMING §1 bis) :
// onglet Emoji (emoji-mart), onglet Image (téléversement nommé, bibliothèque
// filtrable : IconLibrary.tsx). Aussi : l'icône dans l'onglet.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { faviconHref, imageIcon } from "@/lib/icons";
import { ImageTab } from "./IconLibrary";
import { PageIcon } from "./PageIcon";
import { send } from "./request";

type Props = { pageId: string; type: string; initial: string | null };

export function IconPicker({ pageId, type, initial }: Props) {
  const router = useRouter();
  const [icon, setIcon] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  useFavicon(icon, type);

  // Fermeture au clic hors du panneau ou sur Échap.
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
    const previous = icon;
    setIcon(next);
    setOpen(false);
    setError(null);
    const result = await send(`/api/pages/${pageId}`, "PATCH", { icon: next });
    if (!result.ok) {
      setIcon(previous);
      setError(result.error);
      return;
    }
    // La sidebar et les listes sont rendues par le serveur.
    router.refresh();
  }

  return (
    <div className={icon ? "icon-zone" : "icon-zone icon-zone-empty"} ref={zoneRef}>
      {icon ? (
        <button type="button" className="icon-current" aria-label="Changer l'icône" onClick={() => setOpen(!open)}>
          <PageIcon icon={icon} type={type} big />
        </button>
      ) : (
        <button type="button" className="ghost icon-add" onClick={() => setOpen(!open)}>
          ☺ Ajouter une icône
        </button>
      )}
      {error && (
        <span className="status status-error" role="alert">
          {error}
        </span>
      )}
      {open && <IconPanel hasIcon={icon !== null} onChoose={choose} />}
    </div>
  );
}

function IconPanel({ hasIcon, onChoose }: { hasIcon: boolean; onChoose: (icon: string | null) => void }) {
  const [tab, setTab] = useState<"emoji" | "image">("emoji");
  return (
    <div className="icon-panel" role="dialog" aria-label="Choisir une icône">
      <div className="icon-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "emoji"} onClick={() => setTab("emoji")}>
          Emoji
        </button>
        <button type="button" role="tab" aria-selected={tab === "image"} onClick={() => setTab("image")}>
          Image
        </button>
        {hasIcon && (
          <button type="button" className="ghost icon-remove" onClick={() => onChoose(null)}>
            Retirer l&apos;icône
          </button>
        )}
      </div>
      {tab === "emoji" ? <EmojiTab onPick={(emoji) => onChoose(emoji)} /> : <ImageTab onPick={(filename) => onChoose(imageIcon(filename))} />}
    </div>
  );
}

// L'élément em-emoji-picker d'emoji-mart, monté à l'ouverture. Données et
// traduction lui sont passées : sans elles, il irait les chercher sur jsDelivr.
function EmojiTab({ onPick }: { onPick: (emoji: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let element: HTMLElement | null = null;
    Promise.all([import("emoji-mart"), import("@emoji-mart/data"), import("@emoji-mart/data/i18n/fr.json")])
      .then(([{ Picker }, data, i18n]) => {
        if (!alive || !hostRef.current) return;
        element = new Picker({
          data: data.default ?? data,
          i18n: i18n.default ?? i18n,
          locale: "fr",
          set: "native",
          theme: "light",
          autoFocus: true,
          previewPosition: "none",
          skinTonePosition: "search",
          onEmojiSelect: (emoji: { native: string }) => pickRef.current(emoji.native),
        }) as unknown as HTMLElement;
        hostRef.current.appendChild(element);
      })
      .catch(() => setFailed(true));
    return () => {
      alive = false;
      element?.remove();
    };
  }, []);

  if (failed) return <p className="hint">Sélecteur d&apos;emoji indisponible : rechargez la page.</p>;
  return <div className="emoji-host" ref={hostRef} />;
}

// Icône de la page dans l'onglet : un <link rel="icon"> ajouté en fin de
// <head>, que le navigateur préfère aux précédents, retiré en quittant la page.
export function useFavicon(icon: string | null, type: string) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = faviconHref(icon, type);
    link.dataset.pageIcon = "";
    document.head.appendChild(link);
    return () => link.remove();
  }, [icon, type]);
}
