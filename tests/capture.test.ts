import { describe, expect, it } from "vitest";
import { mentionBlock, noteBlock, parseCapture } from "@/lib/capture";

describe("parseCapture", () => {
  it("reconnaît une adresse seule, avec ou sans schéma", () => {
    expect(parseCapture("  https://exemple.org/a?b=1  ")).toEqual({ kind: "link", url: "https://exemple.org/a?b=1" });
    expect(parseCapture("www.exemple.org")).toEqual({ kind: "link", url: "https://www.exemple.org" });
    expect(parseCapture("exemple.org/article")).toEqual({ kind: "link", url: "https://exemple.org/article" });
  });

  it("garde une phrase pour une note, même si elle contient une adresse", () => {
    expect(parseCapture("À lire : https://exemple.org")).toEqual({ kind: "note", text: "À lire : https://exemple.org" });
    expect(parseCapture("Bonjour.")).toEqual({ kind: "note", text: "Bonjour." });
  });

  it("refuse un texte vide", () => {
    expect(parseCapture("  \n ")).toBeNull();
  });
});

describe("noteBlock", () => {
  it("fait un seul paragraphe, retours à la ligne compris", () => {
    expect(noteBlock("Idée\nDébat")).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Idée\nDébat", styles: {} }],
      children: [],
    });
  });

  it("change une adresse nue en mention, titre connu ou non", () => {
    const titles = new Map([["https://exemple.org/a", "Exemple"]]);
    expect(noteBlock("À lire https://exemple.org/a et https://exemple.org/b.", titles)).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "À lire ", styles: {} },
        { type: "mention", props: { url: "https://exemple.org/a", title: "Exemple" } },
        { type: "text", text: " et ", styles: {} },
        { type: "mention", props: { url: "https://exemple.org/b", title: "" } },
        { type: "text", text: ".", styles: {} },
      ],
    });
  });
});

describe("mentionBlock", () => {
  it("fait un paragraphe qui ne contient que la mention", () => {
    expect(mentionBlock("https://exemple.org", "Exemple")).toMatchObject({
      type: "paragraph",
      content: [{ type: "mention", props: { url: "https://exemple.org", title: "Exemple" } }],
    });
  });
});
