import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMN_WIDTH, fixedColumnWidths } from "@/lib/table_layout";

describe("fixedColumnWidths", () => {
  it("garde les largeurs réglées et donne la largeur par défaut aux autres", () => {
    const out = fixedColumnWidths(["title", "a", "b"], { title: 195, b: 334 });
    expect(out.widths).toEqual([195, DEFAULT_COLUMN_WIDTH, 334]);
    expect(out.total).toBe(195 + DEFAULT_COLUMN_WIDTH + 334);
  });

  it("une colonne ajoutée après les réglages n'est jamais à 0", () => {
    const out = fixedColumnWidths(["title", "neuve"], { title: 195 });
    expect(out.widths[1]).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it("ignore une largeur de colonne absente de la liste", () => {
    const out = fixedColumnWidths(["title"], { title: 200, disparue: 500 });
    expect(out).toEqual({ widths: [200], total: 200 });
  });
});
