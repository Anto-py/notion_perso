"use client";
// Gestes du visiteur sur les vues liées d'une page en lecture seule. Le corps
// arrive en HTML (lib/linked_html.ts) : chaque vue liée garde ce rendu, lisible
// sans JavaScript, puis un îlot monté par portail sur .linked-block[data-key]
// le remplace par la même base, filtrable et triable.
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { PublicDatabaseData } from "@/lib/public_view";
import { PublicDatabaseView } from "./PublicDatabaseView";

export type LinkedIsland = { key: string; data: PublicDatabaseData };

const noop = () => () => undefined;

// Faux au rendu serveur et à l'hydratation, vrai ensuite : le portail ne
// cherche ses hôtes qu'une fois le corps en place dans le document.
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function PublicLinkedIslands({ islands }: { islands: LinkedIsland[] }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  // Deux blocs identiques partagent leur clé : chacun reçoit son îlot, et ses
  // gestes restent les siens.
  return islands.flatMap(({ key, data }) =>
    Array.from(document.querySelectorAll<HTMLElement>(`.linked-block[data-key="${CSS.escape(key)}"]`)).map((host, index) => (
      <Island key={`${key}-${index}`} host={host} data={data} />
    )),
  );
}

function Island({ host, data }: { host: HTMLElement; data: PublicDatabaseData }) {
  // Le rendu serveur s'efface sous l'îlot, et revient s'il disparaît.
  useEffect(() => {
    host.classList.add("linked-live");
    return () => host.classList.remove("linked-live");
  }, [host]);
  return createPortal(<PublicDatabaseView data={data} />, host);
}
