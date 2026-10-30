import { describe, expect, it } from "vitest";
import { CAPTURE_TITLE_MAX, noteFromText } from "@/lib/capture";

describe("noteFromText", () => {
  it("prend la première ligne pour titre et garde chaque ligne en paragraphe", () => {
    const note = noteFromText("  Idée séquence  \n\nDébat IA et emploi\nFaire argumenter les élèves.");
    expect(note.title).toBe("Idée séquence");
    expect(note.body).toHaveLength(3);
    expect(note.bodyText).toBe("Idée séquence\nDébat IA et emploi\nFaire argumenter les élèves.");
    expect(note.body[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "Idée séquence", styles: {} }] });
  });

  it("donne un titre de repli à un texte vide", () => {
    const note = noteFromText("   \n  ");
    expect(note.title).toBe("Note");
    expect(note.body).toEqual([]);
    expect(note.bodyText).toBe("");
  });

  it("tronque un titre trop long sans couper au milieu d'un mot", () => {
    const note = noteFromText(`${"mot ".repeat(100)}fin`);
    expect(note.title.length).toBeLessThanOrEqual(CAPTURE_TITLE_MAX);
    expect(note.title.endsWith("mot")).toBe(true);
  });
});
