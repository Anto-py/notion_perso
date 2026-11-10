"use client";
// Effets du système d'onglets : reprise au démarrage, synchronisation avec
// l'URL, mémoire du défilement, interception de Cmd+clic et du clic milieu.
// Ne rend rien : la barre et les écrans lisent le magasin.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { appPathname, startPathname } from "@/lib/tabs";
import {
  getServerSnapshot,
  getSnapshot,
  hydrate,
  open,
  persist,
  rememberScroll,
  resumeTarget,
  scrollFor,
  subscribe,
  syncPathname,
} from "./tabs_store";

export function TabsBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activeRef = useRef<string | null>(null);
  const restoreSequence = useRef(0);

  // Next remet la fenêtre en haut à chaque navigation : on réapplique la
  // position de l'onglet pendant que l'éditeur finit de se charger.
  function restoreScroll(target: number) {
    const sequence = ++restoreSequence.current;
    if (target <= 0) return;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    window.addEventListener("wheel", cancel, { once: true, passive: true });
    window.addEventListener("touchstart", cancel, { once: true, passive: true });
    window.addEventListener("keydown", cancel, { once: true });
    const started = performance.now();
    const tick = () => {
      if (cancelled || sequence !== restoreSequence.current) return;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(target, max));
      const done = Math.abs(window.scrollY - target) <= 2 || max >= target;
      if (!done && performance.now() - started < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    }, 1600);
  }

  useEffect(() => {
    activeRef.current = state.active;
  }, [state.active]);

  // Reprise une fois, avec l'URL du premier rendu. Sur un appareil tactile,
  // la racine ouvre la capture du Vide-cerveau ; une adresse explicite et une
  // navigation ultérieure vers « / » (le « + ») ne sont pas touchées.
  const firstPathname = useRef(pathname);
  useEffect(() => {
    const start = startPathname(firstPathname.current, window.matchMedia("(pointer: coarse)").matches);
    hydrate(start);
    if (start !== firstPathname.current) {
      router.replace(start);
      return;
    }
    const target = resumeTarget();
    if (target) router.replace(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L'URL fait foi : onglet existant activé, sinon l'onglet actif suit.
  useEffect(() => {
    if (!state.ready) return;
    syncPathname(pathname);
    restoreScroll(scrollFor(appPathname(pathname) ?? "/"));
  }, [pathname, state.ready]);

  // Défilement courant de l'onglet actif, sans rendu.
  useEffect(() => {
    const onScroll = () => rememberScroll(activeRef.current, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
    };
  }, []);

  // Cmd+clic, Ctrl+clic et clic milieu sur un lien interne : nouvel onglet.
  useEffect(() => {
    function intercept(event: MouseEvent) {
      if (event.defaultPrevented) return;
      const auxiliary = event.type === "auxclick" && event.button === 1;
      const modified = event.type === "click" && event.button === 0 && (event.metaKey || event.ctrlKey);
      if (!auxiliary && !modified) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!anchor) return;
      // La barre gère elle-même le clic milieu sur un onglet (fermeture).
      if (anchor.closest(".tabs")) return;
      if (anchor.hasAttribute("download")) return;
      const linkTarget = anchor.getAttribute("target");
      if (linkTarget && linkTarget !== "_self") return;
      const href = anchor.getAttribute("href");
      const path = href ? appPathname(href) : null;
      if (!href || !path) return;
      event.preventDefault();
      open(path, true);
      router.push(href);
    }
    document.addEventListener("click", intercept, true);
    document.addEventListener("auxclick", intercept, true);
    return () => {
      document.removeEventListener("click", intercept, true);
      document.removeEventListener("auxclick", intercept, true);
    };
  }, [router]);

  return null;
}
