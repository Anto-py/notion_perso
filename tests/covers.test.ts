import { describe, expect, it } from "vitest";
import {
  checkCoverPosition,
  checkCoverValue,
  COVER_POSITION_DEFAULT,
  colorCover,
  coverPosition,
  imageCover,
  parseCover,
} from "@/lib/covers";

const FILE = "up_AbCdEfGhIjKlMnOp.png";

describe("parseCover", () => {
  it("lit une couleur de la palette et une image par son préfixe", () => {
    expect(parseCover(colorCover("teal"))).toEqual({ kind: "color", color: "teal" });
    expect(parseCover(imageCover(FILE))).toEqual({ kind: "image", filename: FILE });
  });

  it("ignore une couleur hors palette, un PDF et un nom invalide", () => {
    expect(parseCover("color:rose")).toBeNull();
    expect(parseCover("image:up_AbCdEfGhIjKlMnOp.pdf")).toBeNull();
    expect(parseCover("image:../etc/passwd")).toBeNull();
  });

  it("ignore une valeur vide ou d'une autre forme", () => {
    expect(parseCover(null)).toBeNull();
    expect(parseCover("")).toBeNull();
    expect(parseCover("teal")).toBeNull();
  });
});

describe("coverPosition", () => {
  it("ramène la position entre 0 et 100, entière", () => {
    expect(coverPosition(0)).toBe(0);
    expect(coverPosition(100)).toBe(100);
    expect(coverPosition(42.6)).toBe(43);
    expect(coverPosition(-20)).toBe(0);
    expect(coverPosition(180)).toBe(100);
  });

  it("retombe sur le centrage quand la valeur manque ou est illisible", () => {
    expect(coverPosition(null)).toBe(COVER_POSITION_DEFAULT);
    expect(coverPosition(undefined)).toBe(COVER_POSITION_DEFAULT);
    expect(coverPosition(Number.NaN)).toBe(COVER_POSITION_DEFAULT);
  });
});

describe("checkCoverValue", () => {
  it("admet null, une couleur de la palette et une image", () => {
    expect(checkCoverValue(null)).toEqual({ ok: true, value: null, filename: null });
    expect(checkCoverValue(colorCover("sable"))).toEqual({ ok: true, value: "color:sable", filename: null });
    expect(checkCoverValue(imageCover(FILE))).toEqual({ ok: true, value: imageCover(FILE), filename: FILE });
  });

  it("refuse un type autre que chaîne ou null, et une forme inconnue", () => {
    expect(checkCoverValue(42).ok).toBe(false);
    expect(checkCoverValue("color:rose").ok).toBe(false);
    expect(checkCoverValue("image:up_AbCdEfGhIjKlMnOp.pdf").ok).toBe(false);
  });
});

describe("checkCoverPosition", () => {
  it("accepte un nombre fini et le ramène dans les bornes", () => {
    expect(checkCoverPosition(30)).toBe(30);
    expect(checkCoverPosition(140)).toBe(100);
  });

  it("refuse ce qui n'est pas un nombre", () => {
    expect(checkCoverPosition("50")).toBeNull();
    expect(checkCoverPosition(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
