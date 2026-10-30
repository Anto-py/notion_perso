import { describe, expect, it } from "vitest";
import { checkUpload, formatSize, isStoredName, MAX_UPLOAD_BYTES } from "@/lib/upload_rules";

describe("checkUpload", () => {
  it("accepte une image ou un PDF sous la limite, extension tirée du type", () => {
    expect(checkUpload({ size: 1000, type: "image/jpeg" })).toEqual({ ok: true, ext: "jpg" });
    expect(checkUpload({ size: MAX_UPLOAD_BYTES, type: "application/pdf" })).toEqual({ ok: true, ext: "pdf" });
  });

  it("refuse au-delà de 100 Mo avec un message qui dit la taille", () => {
    const check = checkUpload({ size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" });
    expect(check).toMatchObject({ ok: false, status: 413 });
    if (!check.ok) expect(check.error).toContain("100 Mo");
  });

  it("refuse le SVG et tout format hors liste", () => {
    expect(checkUpload({ size: 10, type: "image/svg+xml" })).toMatchObject({ ok: false, status: 415 });
    expect(checkUpload({ size: 10, type: "text/html" })).toMatchObject({ ok: false, status: 415 });
  });
});

describe("isStoredName", () => {
  it("n'admet que les noms produits par l'application", () => {
    expect(isStoredName("up_AbCdEfGhIjKlMn-_.pdf")).toBe(true);
    expect(isStoredName("../.env")).toBe(false);
    expect(isStoredName("up_AbCdEfGhIjKlMn-_.svg")).toBe(false);
    expect(isStoredName("up_court.png")).toBe(false);
  });
});

it("formate les tailles en français", () => {
  expect(formatSize(2_148_000)).toBe("2,0 Mo");
  expect(formatSize(5000)).toBe("5 Ko");
});
