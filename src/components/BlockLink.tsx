"use client";
// « Copier le lien du bloc » du menu de bloc (étape 21, palier d). Le menu de la
// poignée se ferme au clic : l'entrée ne fait que demander la copie
// (useCopyBlockLink), ce fournisseur la mène et le message « Lien copié » sort
// par `onNotice`, en haut de la page.
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { blockLinkUrl, hasBlockId } from "@/lib/block_link";
import { copyText } from "./copy_text";

type Copy = (blockId: string) => void;

const CopyContext = createContext<Copy | null>(null);

// Null hors d'un éditeur de page : l'entrée du menu se masque alors.
export function useCopyBlockLink(): Copy | null {
  return useContext(CopyContext);
}

type Props = {
  pageId: string;
  // Adresse du site à copier : `SYNC_REMOTE_URL` sur le Mac (jamais localhost,
  // qu'un autre appareil ne joindrait pas), vide sur le web, où l'origine de la
  // page fait foi.
  siteOrigin: string;
  // Corps tel que chargé : un bloc qui n'y figure pas porte un identifiant que
  // l'éditeur a posé au chargement et que rien n'a encore enregistré.
  initialBody: unknown[];
  onNotice: (message: string) => void;
  // Met en file l'enregistrement du corps courant.
  onSave: () => void;
  children: ReactNode;
};

export function BlockLinkProvider({ pageId, siteOrigin, initialBody, onNotice, onSave, children }: Props) {
  const copy = useCallback<Copy>(
    async (blockId) => {
      const ok = await copyText(blockLinkUrl(siteOrigin || window.location.origin, pageId, blockId));
      onNotice(ok ? "Lien copié" : "Copie impossible");
      // Un lien vers un identifiant jamais enregistré mènerait nulle part après
      // un rechargement : on le fait enregistrer avec le corps.
      if (ok && !hasBlockId(initialBody, blockId)) onSave();
    },
    [pageId, siteOrigin, initialBody, onNotice, onSave],
  );
  return <CopyContext.Provider value={copy}>{children}</CopyContext.Provider>;
}
