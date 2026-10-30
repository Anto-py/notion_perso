"use client";
// Sous-pages nées du menu « / » d'une page : création de l'enfant, et
// corbeille quand son dernier bloc-lien disparaît du corps ; restauration s'il
// revient (Ctrl + Z, collage). Seules les vraies sous-pages de cette page sont
// concernées : effacer un bloc collé d'ailleurs ne jette rien.
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { refChanges, subpageRefs } from "@/lib/blocks";
import type { TreeRow } from "@/lib/tree";
import type { ChildKind } from "./Editor";
import { send } from "./request";
import { addToDirectory, getPageDirectory, setPageDirectory } from "./subpageBlock";

export function useSubpages(pageId: string, initialBody: unknown[], directory: TreeRow[], onError: (message: string) => void) {
  const router = useRouter();
  const refs = useRef(subpageRefs(initialBody));
  // Jetées par cette page depuis son ouverture : les seules qu'un retour du
  // bloc restaure (une sous-page supprimée depuis sa propre page reste jetée).
  const trashed = useRef(new Set<string>());
  // Une requête à la fois, dans l'ordre des gestes : effacer puis annuler
  // aussitôt doit jeter puis restaurer, jamais l'inverse.
  const chain = useRef<Promise<void>>(Promise.resolve());

  // L'annuaire suit chaque rendu serveur (titre changé, page déplacée).
  useEffect(() => {
    setPageDirectory(directory);
  }, [directory]);

  async function createChild(kind: ChildKind): Promise<string | null> {
    const result = await send("/api/pages", "POST", { parentId: pageId, type: kind });
    if (!result.ok || typeof result.data.id !== "string") {
      onError(result.ok ? "Création impossible : réessayez." : result.error);
      return null;
    }
    const id = result.data.id;
    addToDirectory({ id, parentId: pageId, type: kind, title: "", icon: null });
    router.refresh();
    return id;
  }

  function bodyChanged(body: unknown[]) {
    const next = subpageRefs(body);
    const { gone, back } = refChanges(refs.current, next);
    refs.current = next;
    const pages = getPageDirectory();
    const toTrash = gone.filter((id) => pages.get(id)?.parentId === pageId && !trashed.current.has(id));
    const toRestore = back.filter((id) => trashed.current.has(id));
    if (!toTrash.length && !toRestore.length) return;
    // Marqué tout de suite, pas au retour de la requête : une annulation
    // immédiate doit savoir que la page part en corbeille.
    for (const id of toTrash) trashed.current.add(id);
    for (const id of toRestore) trashed.current.delete(id);
    chain.current = chain.current.then(async () => {
      for (const id of toTrash) {
        const result = await send(`/api/pages/${id}`, "DELETE");
        if (!result.ok) {
          trashed.current.delete(id);
          onError(result.error);
        }
      }
      for (const id of toRestore) {
        const result = await send("/api/trash", "POST", { id });
        if (!result.ok) onError(result.error);
      }
      router.refresh();
    });
  }

  return { createChild, bodyChanged };
}
