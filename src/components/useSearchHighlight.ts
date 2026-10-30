"use client";
// Surligne dans le corps de la page les mots de ?q=…, venus d'un résultat de
// recherche. Passe par la CSS Custom Highlight API : des Range colorés par
// ::highlight(recherche), sans toucher au DOM de BlockNote, qui relirait un
// <mark> inséré comme du contenu et l'enregistrerait.
import { useSearchParams } from "next/navigation";
import { useEffect, type RefObject } from "react";
import { highlightRanges, searchTerms } from "@/lib/search";

const NAME = "recherche";
const WAIT_MS = 4000;

export function useSearchHighlight(container: RefObject<HTMLElement | null>) {
  const query = useSearchParams().get("q") ?? "";

  useEffect(() => {
    const terms = searchTerms(query);
    const root = container.current;
    // Navigateur sans l'API (Firefox avant 140) : la page s'ouvre sans surlignage.
    if (!terms.length || !root || typeof CSS === "undefined" || !("highlights" in CSS)) return;

    const clear = () => CSS.highlights.delete(NAME);

    let scrolled = false;
    const apply = () => {
      const editor = root.querySelector(".bn-editor");
      if (!editor) return;
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const [start, end] of highlightRanges(node.textContent ?? "", terms)) {
          const range = new Range();
          range.setStart(node, start);
          range.setEnd(node, end);
          ranges.push(range);
        }
      }
      if (!ranges.length) return;
      CSS.highlights.set(NAME, new Highlight(...ranges));
      if (!scrolled) {
        scrolled = true;
        ranges[0].startContainer.parentElement?.scrollIntoView({ block: "center" });
      }
    };

    // L'éditeur arrive après la page (next/dynamic), puis ProseMirror peut
    // réécrire ses nœuds texte, ce qui replie les Range posées : on réapplique
    // à chaque mutation pendant quelques secondes, puis on cesse d'observer.
    const observer = new MutationObserver(apply);
    const timer = setTimeout(() => observer.disconnect(), WAIT_MS);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    apply();
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    // Dès la première frappe, les positions ne valent plus : le surlignage s'efface.
    const onInput = () => {
      stop();
      clear();
    };
    root.addEventListener("input", onInput, { once: true });

    return () => {
      stop();
      clear();
      root.removeEventListener("input", onInput);
    };
  }, [query, container]);
}
