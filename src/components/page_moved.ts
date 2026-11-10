"use client";
// Une page vient de changer de mère par l'arbre : son bloc a quitté le corps
// de l'ancienne et rejoint celui de la nouvelle (lib/pages.ts, movePage).
// L'éditeur ouvert sur l'une d'elles se relit (useAutosave) ; son annuaire
// apprend la nouvelle mère avant que le corps relu n'arrive (useSubpages),
// faute de quoi le bloc disparu ferait jeter la page déplacée.
export type PageMoved = { pageId: string; from: string | null; to: string | null };

const PAGE_MOVED = "np:page-moved";

export function announcePageMoved(moved: PageMoved): void {
  window.dispatchEvent(new CustomEvent<PageMoved>(PAGE_MOVED, { detail: moved }));
}

export function onPageMoved(listener: (moved: PageMoved) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<PageMoved>).detail);
  window.addEventListener(PAGE_MOVED, handler);
  return () => window.removeEventListener(PAGE_MOVED, handler);
}
