"use client";
// Magasin des onglets, hors de React, sur le modèle de l'annuaire des pages
// (subpageBlock.tsx). La barre et le pont d'effets s'y abonnent ; les écrans y
// publient leur titre. La navigation reste celle de Next : l'URL fait foi.
import { useEffect } from "react";
import {
  appPathname,
  closeTab as closePure,
  defaultMeta,
  moveTab as movePure,
  openTab as openPure,
  restoreTabs,
  visit as visitPure,
  type StoredTabs,
  type TabMeta,
  type TabsState,
} from "@/lib/tabs";
import type { TreeRow } from "@/lib/tree";

const STORAGE_KEY = "np_onglets";
const EMPTY: TabsState = { tabs: [], active: null, ready: false };

let state: TabsState = EMPTY;
let hydrated = false;
// Page à rouvrir quand l'application démarre sur « / » : la dernière active.
let resume: string | null = null;
const listeners = new Set<() => void>();
// Mémoire des titres : arbre de la sidebar et écrans ouverts y écrivent.
const meta = new Map<string, TabMeta>();
// Position de défilement par onglet, tenue hors du rendu.
const scroll = new Map<string, number>();

function notify(): void {
  for (const listener of listeners) listener();
}

function set(next: TabsState): void {
  state = next;
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): TabsState {
  return state;
}

export function getServerSnapshot(): TabsState {
  return EMPTY;
}

function metaFor(href: string): TabMeta {
  return meta.get(href) ?? defaultMeta(href);
}

// Un écran publie son titre : une entrée de base, absente de l'arbre, garde
// ainsi son libellé, et un titre enregistré corrige l'onglet.
export function setTabMeta(href: string, next: TabMeta): void {
  const title = next.title || "Sans titre";
  const icon = next.icon ?? null;
  const previous = meta.get(href);
  if (previous && previous.title === title && previous.icon === icon && previous.type === next.type) return;
  meta.set(href, { title, icon, type: next.type });
  if (!state.ready || !state.tabs.some((tab) => tab.href === href)) return;
  set({ ...state, tabs: state.tabs.map((tab) => (tab.href === href ? { ...tab, title, icon, type: next.type } : tab)) });
  persist();
}

// L'arbre de la sidebar fournit titres et icônes, y compris aux onglets
// inactifs. Les entrées de base n'y figurent pas : leur écran les publie.
export function setTreeMeta(rows: readonly TreeRow[]): void {
  for (const row of rows) {
    const href = row.type === "database" ? `/db/${row.id}` : `/page/${row.id}`;
    meta.set(href, { title: row.title || "Sans titre", icon: row.icon, type: row.type });
  }
  if (!state.ready) return;
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    const next = meta.get(tab.href);
    if (!next || (next.title === tab.title && next.icon === tab.icon && next.type === tab.type)) return tab;
    changed = true;
    return { ...tab, ...next };
  });
  if (changed) {
    set({ ...state, tabs });
    persist();
  }
}

export function hydrate(pathname: string): void {
  if (hydrated) return;
  hydrated = true;
  const stored = readStorage();
  for (const [href, value] of Object.entries(stored.scroll)) {
    if (typeof value === "number" && Number.isFinite(value)) scroll.set(href, value);
  }
  let next = restoreTabs(stored, pathname);
  // L'app Mac se relance sur « / » : sans cette reprise, l'onglet actif de la
  // veille retomberait sur l'Accueil. Une URL explicite reste maîtresse.
  if (pathname === "/") {
    const storedActive = typeof stored.active === "string" ? appPathname(stored.active) : null;
    if (storedActive && storedActive !== "/" && next.tabs.some((tab) => tab.href === storedActive)) {
      next = { ...next, active: storedActive };
      resume = storedActive;
    }
  }
  set({
    ...next,
    tabs: next.tabs.map((tab) => {
      const known = meta.get(tab.href);
      return known ? { ...tab, ...known } : tab;
    }),
  });
  persist();
}

// Page à rejoindre après la reprise, lue une fois par le pont.
export function resumeTarget(): string | null {
  return resume;
}

export function syncPathname(pathname: string): void {
  if (!state.ready) return;
  const href = appPathname(pathname);
  if (!href) return;
  // Tant que la navigation de reprise n'a pas atteint sa page, l'URL de départ
  // « / » ne doit pas écraser l'onglet actif restauré.
  if (resume) {
    if (href === resume) resume = null;
    else if (href === "/") return;
    else resume = null;
  }
  const next = visitPure(state, href, metaFor(href));
  if (next !== state) {
    set(next);
    persist();
  }
}

export function open(href: string, activate = true): void {
  if (!state.ready) return;
  const next = openPure(state, href, metaFor(href), activate);
  if (next !== state) {
    set(next);
    persist();
  }
}

export function close(href: string): string | null {
  const outcome = closePure(state, href);
  if (outcome.state !== state) {
    set(outcome.state);
    persist();
  }
  return outcome.destination;
}

export function reorder(from: number, to: number): void {
  const next = movePure(state, from, to);
  if (next !== state) {
    set(next);
    persist();
  }
}

export function rememberScroll(href: string | null, y: number): void {
  if (!href) return;
  scroll.set(href, y);
}

export function scrollFor(href: string): number {
  return scroll.get(href) ?? 0;
}

// Le défilement ne déclenche pas d'écriture : il part avec l'état au changement
// d'onglet et une dernière fois à la fermeture ou au masquage de la page.
export function persist(): void {
  if (!state.ready) return;
  const payload: StoredTabs = {
    tabs: state.tabs.map(({ href, title, icon, type }) => ({ href, title, icon, type })),
    active: state.active,
    scroll: Object.fromEntries(scroll),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Stockage refusé : les onglets vivent le temps de la page.
  }
}

function readStorage(): StoredTabs & { scroll: Record<string, unknown> } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredTabs) : null;
    return {
      ...parsed,
      scroll: parsed && typeof parsed.scroll === "object" && parsed.scroll ? parsed.scroll : {},
    };
  } catch {
    return { scroll: {} };
  }
}

// Un écran publie son titre à chaque changement : l'onglet actif suit la
// frappe enregistrée.
export function useTabMeta(href: string, title: string, icon: string | null, type?: string): void {
  useEffect(() => {
    setTabMeta(href, { title, icon, type });
  }, [href, title, icon, type]);
}
