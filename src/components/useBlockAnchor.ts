"use client";
// Arrivée sur `/page/<id>#<bloc>` (étape 21, palier d) : défile jusqu'au bloc et
// l'éclaire un instant. Le bloc absent de la page, déplacé depuis, est cherché
// dans les autres pages par son identifiant (GET /api/blocks/<bloc>) puis on s'y
// rend ; introuvable (supprimé), la page reste ouverte en haut, sans erreur.
//
// L'éclat est un calque posé à côté de l'éditeur, comme le trait de dépôt
// (`editor-drop-line`) : une classe posée sur un nœud de BlockNote serait
// réécrite par ProseMirror.
import { useRouter } from "next/navigation";
import { useEffect, useState, type RefObject } from "react";
import { blockIdFromHash } from "@/lib/block_link";

// Le bloc ne se trouve pas au-delà : le corps est chargé à la création de
// l'éditeur, ce délai ne couvre que le montage.
const FIND_MS = 800;
// Les images et les vues liées changent la hauteur après coup : on réaligne
// pendant ce temps, tant que la personne n'a pas pris la main.
const SETTLE_MS = 1500;
const FLASH_MS = 2600;

export type FlashBox = { top: number; left: number; width: number; height: number };

export function useBlockAnchor(host: RefObject<HTMLElement | null>, pageId: string): FlashBox | null {
  const router = useRouter();
  const [flash, setFlash] = useState<FlashBox | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let stopSeeking = () => {};
    let clearTimer: number | undefined;

    const seek = () => {
      stopSeeking();
      window.clearTimeout(clearTimer);
      const id = blockIdFromHash(window.location.hash);
      if (!id) return;

      let cancelled = false;
      let found = false;
      let frame = 0;
      const started = performance.now();
      const cancel = () => {
        cancelled = true;
      };
      const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
      for (const name of events) window.addEventListener(name, cancel, { once: true, passive: true });

      const tick = () => {
        if (cancelled) return;
        const element = root.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
        const elapsed = performance.now() - started;
        if (element) {
          if (!found) {
            found = true;
            clearTimer = window.setTimeout(() => setFlash(null), FLASH_MS);
          }
          align(element);
          const box = boxOf(element, root);
          setFlash((current) => (sameBox(current, box) ? current : box));
        } else if (elapsed > FIND_MS) {
          void relocate(id, pageId, (to) => router.replace(`/page/${to}#${id}`));
          return;
        }
        if (elapsed < SETTLE_MS) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      stopSeeking = () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        for (const name of events) window.removeEventListener(name, cancel);
      };
    };

    seek();
    window.addEventListener("hashchange", seek);
    return () => {
      window.removeEventListener("hashchange", seek);
      stopSeeking();
      window.clearTimeout(clearTimer);
    };
  }, [host, pageId, router]);

  return flash;
}

// Le bloc se pose au quart de la fenêtre, sous la barre d'onglets collante.
function align(element: HTMLElement) {
  const top = element.getBoundingClientRect().top + window.scrollY - Math.round(window.innerHeight * 0.25);
  if (Math.abs(window.scrollY - top) > 2) window.scrollTo(0, Math.max(0, top));
}

function boxOf(element: HTMLElement, host: HTMLElement): FlashBox {
  const outer = element.getBoundingClientRect();
  const origin = host.getBoundingClientRect();
  return { top: outer.top - origin.top, left: outer.left - origin.left, width: outer.width, height: outer.height };
}

function sameBox(a: FlashBox | null, b: FlashBox): boolean {
  return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

// Page qui porte maintenant le bloc, hors celle-ci ; rien si le serveur n'en
// connaît aucune ou ne répond pas.
async function relocate(blockId: string, fromId: string, go: (pageId: string) => void) {
  const response = await fetch(`/api/blocks/${encodeURIComponent(blockId)}?not=${encodeURIComponent(fromId)}`).catch(() => null);
  if (!response?.ok) return;
  const data = (await response.json().catch(() => null)) as { pageId?: unknown } | null;
  if (typeof data?.pageId === "string") go(data.pageId);
}
