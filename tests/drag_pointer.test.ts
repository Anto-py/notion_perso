import { describe, expect, it } from "vitest";
import { isBeforeMiddle, pointerAt } from "@/lib/drag_pointer";

describe("pointerAt", () => {
  it("ajoute le déplacement au point d'appui de la souris", () => {
    expect(pointerAt({ clientX: 100, clientY: 200 }, { x: 5, y: -30 })).toEqual({ x: 105, y: 170 });
  });

  it("lit le premier doigt d'un événement tactile", () => {
    const touch = { touches: [{ clientX: 40, clientY: 60 }] };
    expect(pointerAt(touch, { x: 0, y: 10 })).toEqual({ x: 40, y: 70 });
  });

  it("rend null sans coordonnées (clavier, événement absent)", () => {
    expect(pointerAt({ key: "Space" }, { x: 0, y: 0 })).toBeNull();
    expect(pointerAt(null, { x: 0, y: 0 })).toBeNull();
    expect(pointerAt(undefined, { x: 0, y: 0 })).toBeNull();
    expect(pointerAt({ touches: [] }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("isBeforeMiddle", () => {
  it("vrai au-dessus du milieu, faux au milieu et dessous", () => {
    expect(isBeforeMiddle(10, 0, 100)).toBe(true);
    expect(isBeforeMiddle(49.9, 0, 100)).toBe(true);
    expect(isBeforeMiddle(50, 0, 100)).toBe(false);
    expect(isBeforeMiddle(90, 0, 100)).toBe(false);
  });

  it("tient compte du début de la cible", () => {
    expect(isBeforeMiddle(130, 100, 100)).toBe(true);
    expect(isBeforeMiddle(160, 100, 100)).toBe(false);
  });
});
