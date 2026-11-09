"use client";
// Magasin de la barre latérale, hors de React, sur le modèle de tabs_store : la
// barre d'onglets et la poignée de largeur s'y abonnent. Le réglage vit dans
// localStorage, par appareil ; l'écriture n'a lieu qu'au lâcher du glisser, pas
// à chaque déplacement.
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_HIDDEN_ATTRIBUTE,
  SIDEBAR_STORAGE_KEY,
  clampSidebarWidth,
  parseSidebarState,
  sidebarStateText,
  type SidebarState,
} from "@/lib/sidebar";

export type SidebarSnapshot = SidebarState & { ready: boolean };

const EMPTY: SidebarSnapshot = { ...SIDEBAR_DEFAULT, ready: false };

let state: SidebarSnapshot = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SidebarSnapshot {
  return state;
}

export function getServerSnapshot(): SidebarSnapshot {
  return EMPTY;
}

// Le CSS lit la variable ; l'attribut masque la barre sur ordinateur seulement.
function apply(next: SidebarState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--sidebar-width", `${next.width}px`);
  if (next.hidden) root.setAttribute(SIDEBAR_HIDDEN_ATTRIBUTE, "hidden");
  else root.removeAttribute(SIDEBAR_HIDDEN_ATTRIBUTE);
}

function read(): string | null {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function write(): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarStateText(state));
  } catch {
    // Stockage refusé (navigation privée) : le réglage vaut pour la session.
  }
}

function set(next: SidebarState, persist: boolean): void {
  state = { width: clampSidebarWidth(next.width), hidden: next.hidden === true, ready: true };
  apply(state);
  if (persist) write();
  notify();
}

// Une seule lecture au montage : le script posé avant peinture a déjà appliqué
// le réglage au document, cette reprise met l'état React en accord.
export function hydrateSidebar(): void {
  if (hydrated) return;
  hydrated = true;
  set(parseSidebarState(read()), false);
}

export function toggleSidebar(): void {
  set({ width: state.width, hidden: !state.hidden }, true);
}

export function setSidebarHidden(hidden: boolean, persist = true): void {
  if (hidden === state.hidden) {
    if (persist) write();
    return;
  }
  set({ width: state.width, hidden }, persist);
}

// `persist` faux pendant le glisser, vrai au lâcher.
export function setSidebarWidth(raw: unknown, persist = true): void {
  const width = clampSidebarWidth(raw);
  if (width === state.width) {
    if (persist) write();
    return;
  }
  set({ width, hidden: state.hidden }, persist);
}

export function resetSidebarWidth(): void {
  setSidebarWidth(SIDEBAR_DEFAULT.width);
}
